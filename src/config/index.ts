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
import { loadProjectConfig, loadGlobalConfig, loadLocalConfig } from './sources/file.js';
import { buildEnvConfig, loadDotEnv } from './sources/env.js';
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

export interface LoadConfigResult {
  readonly config: ResolvedConfig;
  readonly sources: {
    readonly defaults: boolean;
    readonly global: string | null;
    readonly project: string | null;
    readonly local: string | null;
    readonly env: boolean;
    readonly args: boolean;
  };
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
  let globalConfig: ResolvedConfig | null = null;
  let projectConfig: ResolvedConfig | null = null;
  let localConfig: ResolvedConfig | null = null;
  let envConfig: ResolvedConfig | null = null;
  let argsConfig: ResolvedConfig | null = null;

  const layers: ResolvedConfig[] = [defaultsLayer];

  try {
    globalConfig = await loadGlobalConfig(cwd);
  } catch (err) {
    warnings.push(`global config: ${(err as Error).message}`);
  }
  if (globalConfig) {
    layers.push(globalConfig);
  }

  try {
    projectConfig = await loadProjectConfig(cwd);
  } catch (err) {
    warnings.push(`project config: ${(err as Error).message}`);
  }
  if (projectConfig) {
    layers.push(projectConfig);
  }

  try {
    localConfig = await loadLocalConfig(cwd);
  } catch (err) {
    warnings.push(`local config: ${(err as Error).message}`);
  }
  if (localConfig) {
    layers.push(localConfig);
  }

  try {
    envConfig = buildEnvConfig();
  } catch (err) {
    warnings.push(`env config: ${(err as Error).message}`);
  }
  if (envConfig) {
    layers.push(envConfig);
  }

  if (args) {
    argsConfig = buildArgsConfig(args);
    if (argsConfig) {
      layers.push(argsConfig);
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

  return {
    config: merged,
    sources: {
      defaults: true,
      global: globalConfig ? '<loaded>' : null,
      project: projectConfig ? '<loaded>' : null,
      local: localConfig ? '<loaded>' : null,
      env: envConfig !== null,
      args: argsConfig !== null,
    },
    warnings,
  };
}

import { BUILTIN_EXCLUDE_GROUPS } from './groups.js';

const BUILTIN_BY_NAME: ReadonlyMap<string, readonly string[]> = new Map(
  BUILTIN_EXCLUDE_GROUPS.map((g) => [g.name, g.globs] as const),
);

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