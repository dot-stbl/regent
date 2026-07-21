// Public config API.
//
// `loadConfig()` is the single entry point that:
//   1. Reads `.env` (best-effort) into process.env.
//   2. Reads `~/.config/regent/config.*` (global layer).
//   3. Reads `<cwd>/.regentrc.*` (project layer) — walks up.
//   4. Reads `<cwd>/.regentrc.local.*` (per-dev layer) — gitignored.
//   5. Reads `STBL_REGENT_*` env vars (env layer).
//   6. Translates commander options (args layer — highest precedence).
//   7. Merges all layers through `mergeConfigs()`.
//
// Returns a `ResolvedConfig` (alias for `RegentConfig` after merge).
// Errors are typed via `LoadConfigError` so callers can distinguish
// not-found, validation-failed, and IO errors.

import { defaultConfig } from './sources/defaults.js';
import {
  loadProjectConfigLayer,
  loadGlobalConfigLayer,
  loadLocalConfigLayer,
} from './sources/file.js';
import { buildEnvConfig, loadDotEnv, collectEnvVarNames } from './sources/env.js';
import { buildArgsConfig, type CliArgs } from './sources/args.js';
import { mergeConfigs } from './merge.js';
import type { RegentConfig } from './schema.js';

export type { RegentConfig, DetectRuleSpec, FixRuleSpec } from './schema.js';
export type { CliArgs } from './sources/args.js';

export interface LoadConfigOptions {
  readonly cwd: string;
  readonly args?: CliArgs;
}

/**
 * The final resolved config — already merged across all layers.
 * Excludes-only-keys fields (like `excludeGroups`) reflect the final
 * state of user + builtin groups.
 */
export type ResolvedConfig = RegentConfig;

export type LoadConfigError =
  | { kind: 'validation'; layer: string; source: string; message: string }
  | { kind: 'io'; layer: string; source: string; message: string };

/**
 * Per-layer provenance for the merged config. Each layer entry is
 * either a no-op (not loaded) or a structured record describing where
 * the layer came from. The legacy string-marker fields
 * (`defaults/global/project/local/env/args`) are kept for backward
 * compatibility — new consumers should use the structured `layers[]`.
 */
export interface LayerSources {
  readonly defaults: boolean;
  /** @deprecated use `layers[].path` when present. */
  readonly global: string | null;
  /** @deprecated use `layers[].path` when present. */
  readonly project: string | null;
  /** @deprecated use `layers[].path` when present. */
  readonly local: string | null;
  /** @deprecated use `layers[].envVars` when present. */
  readonly env: boolean;
  /** @deprecated use `layers[].args` when present. */
  readonly args: boolean;
}

export interface ConfigLayerEntry {
  /** Stable layer id — used by `regent config layers`. */
  readonly id: 'defaults' | 'global' | 'project' | 'local' | 'env' | 'args';
  /** True when this layer contributed to the merged config. */
  readonly loaded: boolean;
  /** Absolute file path for file-sourced layers; null otherwise. */
  readonly path: string | null;
  /** Env-var names that contributed (env layer only). */
  readonly envVars: readonly string[];
  /** CLI-arg names that contributed (args layer only). */
  readonly args: readonly string[];
  /** The layer's per-layer config (defaults always present; others null if not loaded). */
  readonly config: ResolvedConfig | null;
}

export interface LoadConfigResult {
  readonly config: ResolvedConfig;
  readonly sources: LayerSources;
  /** Per-layer provenance in precedence order (low → high). */
  readonly layers: readonly ConfigLayerEntry[];
  readonly warnings: readonly string[];
}

/**
 * Load and merge all config layers. Resolves `@group` references in
 * `excludePaths` against the union of built-in + user-defined groups.
 */
export async function loadConfig(
  options: LoadConfigOptions,
): Promise<LoadConfigResult> {
  const { cwd, args } = options;

  loadDotEnv(cwd);

  const warnings: string[] = [];

  const defaultsLayer = defaultConfig();
  let globalLayer: { config: ResolvedConfig; path: string | null } | null = null;
  let projectLayer: { config: ResolvedConfig; path: string | null } | null = null;
  let localLayer: { config: ResolvedConfig; path: string | null } | null = null;
  let envLayer: ResolvedConfig | null = null;
  let argsLayer: ResolvedConfig | null = null;

  const layers: ResolvedConfig[] = [defaultsLayer];

  try {
    const result = await loadGlobalConfigLayer(cwd);
    if (result) {
      globalLayer = { config: result.config, path: result.path };
      layers.push(result.config);
    }
  } catch (err) {
    warnings.push(`global config: ${(err as Error).message}`);
  }

  try {
    const result = await loadProjectConfigLayer(cwd);
    if (result) {
      projectLayer = { config: result.config, path: result.path };
      layers.push(result.config);
    }
  } catch (err) {
    warnings.push(`project config: ${(err as Error).message}`);
  }

  try {
    const result = await loadLocalConfigLayer(cwd);
    if (result) {
      localLayer = { config: result.config, path: result.path };
      layers.push(result.config);
    }
  } catch (err) {
    warnings.push(`local config: ${(err as Error).message}`);
  }

  try {
    envLayer = buildEnvConfig();
  } catch (err) {
    warnings.push(`env config: ${(err as Error).message}`);
  }
  if (envLayer) {
    layers.push(envLayer);
  }

  if (args) {
    argsLayer = buildArgsConfig(args);
    if (argsLayer) {
      layers.push(argsLayer);
    }
  }

  const merged = mergeConfigs(layers);

  // Detect silent user-override of built-in groups — surfaces drift.
  const overriddenBuiltins: string[] = [];
  for (const [name, globsRaw] of Object.entries(merged.excludeGroups)) {
    const globs = globsRaw as readonly string[];
    const builtin = BUILTIN_BY_NAME.get(name);
    if (builtin && !arraysEqual(builtin, globs)) {
      overriddenBuiltins.push(name);
    }
  }
  for (const name of overriddenBuiltins) {
    warnings.push(`exclude group '@${name}' overrides a built-in`);
  }

  const envVars = collectEnvVarNames();
  const layerEntries: ConfigLayerEntry[] = [
    { id: 'defaults', loaded: true, path: null, envVars: [], args: [], config: defaultsLayer },
    {
      id: 'global',
      loaded: globalLayer !== null,
      path: globalLayer?.path ?? null,
      envVars: [],
      args: [],
      config: globalLayer?.config ?? null,
    },
    {
      id: 'project',
      loaded: projectLayer !== null,
      path: projectLayer?.path ?? null,
      envVars: [],
      args: [],
      config: projectLayer?.config ?? null,
    },
    {
      id: 'local',
      loaded: localLayer !== null,
      path: localLayer?.path ?? null,
      envVars: [],
      args: [],
      config: localLayer?.config ?? null,
    },
    {
      id: 'env',
      loaded: envLayer !== null,
      path: null,
      envVars,
      args: [],
      config: envLayer,
    },
    {
      id: 'args',
      loaded: argsLayer !== null,
      path: null,
      envVars: [],
      args: args ? collectArgNames(args) : [],
      config: argsLayer,
    },
  ];

  return {
    config: merged,
    sources: {
      defaults: true,
      global: globalLayer ? (globalLayer.path ?? '<loaded>') : null,
      project: projectLayer ? (projectLayer.path ?? '<loaded>') : null,
      local: localLayer ? (localLayer.path ?? '<loaded>') : null,
      env: envLayer !== null,
      args: argsLayer !== null,
    },
    layers: layerEntries,
    warnings,
  };
}

import { BUILTIN_EXCLUDE_GROUPS } from './groups.js';

const BUILTIN_BY_NAME: ReadonlyMap<string, readonly string[]> = new Map(
  BUILTIN_EXCLUDE_GROUPS.map((g) => [g.name, g.globs] as const),
);

/**
 * List the CLI-arg keys that contributed to the args layer. Used by
 * `regent config layers` to display which flags are active in this run.
 */
function collectArgNames(args: CliArgs): readonly string[] {
  const names: string[] = [];
  if (args.logLevel !== undefined) names.push('--log-level');
  if (args.logFormat !== undefined) names.push('--log-format');
  if (args.color !== undefined) names.push('--no-color / --color');
  if (args.cache !== undefined) names.push('--no-cache');
  if (args.contextBuffer !== undefined) names.push('--context-buffer');
  return names;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}