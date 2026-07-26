// Per-scope config loading (issue #35 + #105).
//
// When `-s <name>` is selected, the runner loads config from the
// scope's root first, falling back to the repo's config if no
// `.regentrc.*` lives under the scope's root. This is exactly what
// `cosmiconfig`'s "walk up from cwd" search already gives us — see
// `src/config/sources/file.ts#fileExplorer`, which stops at
// `process.cwd()`. Re-anchoring `cwd` to the scope's root makes the
// scope config the new "project" layer; env / args still trump.
//
// **Issue #105:** a scope may also declare its rule set inline via
// `extends: [...]` on the scope spec itself. `resolveScopeExtends`
// turns that array into a synthetic `RegentConfig` whose
// `rules.extends` matches the array verbatim — the loader's existing
// `resolveExtendsItem` machinery (paths / globs / npm / inline rule
// arrays) then resolves each entry at load time. The synthetic layer
// is the lowest-precedence layer for the scope, so on-disk
// `.regentrc.*` wins on conflicts (last-wins via `mergeConfigs`).

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadProjectConfigLayer, loadLocalConfigLayer } from './sources/file.js';
import type { RegentConfig, ScopeSpec } from './schema.js';
import type { ResolvedScope } from './scopes.js';
import { defaultConfig } from './sources/defaults.js';

export interface ScopeConfigLayer {
  readonly config: RegentConfig;
  /** Absolute path to the loaded `.regentrc.*`, or null if no scope config exists. */
  readonly projectPath: string | null;
  /** Absolute path to the loaded `.regentrc.local.*`, or null. */
  readonly localPath: string | null;
}

/**
 * Build a synthetic `RegentConfig` whose `rules.extends` mirrors the
 * scope's inline `extends[]` (issue #105). When this layer is the
 * lowest-precedence layer for a scope's merge, every entry flows
 * through the existing loader `resolveExtendsItem` pipeline — paths,
 * globs, npm package specs, and inline rule arrays are all handled.
 *
 * The rest of the returned config is the Zod defaults (`scopes: {}`,
 * empty rule arrays, etc.) so `mergeConfigs` can fold the layer
 * without any field touching other layers.
 */
export function resolveScopeExtends(
  extendsSpec: ScopeSpec['extends'],
): RegentConfig {
  const base = defaultConfig();
  return {
    ...base,
    rules: {
      ...base.rules,
      extends: extendsSpec,
    },
  };
}

/**
 * Load the scope-level config (project + local) for a single scope.
 *
 * Cosmiconfig walks up from `scope.root` looking for `.regentrc.*`
 * (stopping at `process.cwd()` per `sources/file.ts#fileExplorer`).
 * That means the scope's own config wins; if none exists, the repo's
 * config is inherited — exactly the layering the issue requires
 * (`root → scope → local`, where "local" is also scope-anchored).
 *
 * Issue #105: a scope may also carry inline `extends: [...]` on the
 * `ScopeSpec` itself. When present, the extends array becomes the
 * lowest-precedence layer in the merge (just above the defaults), so
 * on-disk project/local layers win on conflicts via `mergeConfigs`
 * last-wins semantics. `ScopeConfigMissingError` only fires when
 * the scope has NEITHER an on-disk config NOR inline `extends`.
 */
export async function loadScopeConfigLayer(
  scope: ResolvedScope,
  scopeSpec?: ScopeSpec,
): Promise<ScopeConfigLayer> {
  let projectPath: string | null = null;
  let projectConfig: RegentConfig | null = null;
  try {
    const result = await loadProjectConfigLayer(scope.root);
    if (result !== null) {
      projectConfig = result.config;
      projectPath = result.path;
    }
  } catch (err) {
    throw new Error(
      `scope '${scope.name}' config load failed: ${(err as Error).message}`,
      { cause: err },
    );
  }

  let localPath: string | null = null;
  let localConfig: RegentConfig | null = null;
  try {
    const result = await loadLocalConfigLayer(scope.root);
    if (result !== null) {
      localConfig = result.config;
      localPath = result.path;
    }
  } catch (err) {
    throw new Error(
      `scope '${scope.name}' local config load failed: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const extendsLayer = scopeSpec?.extends && scopeSpec.extends.length > 0
    ? resolveScopeExtends(scopeSpec.extends)
    : null;

  if (projectConfig === null && localConfig === null && extendsLayer === null) {
    throw new ScopeConfigMissingError(scope);
  }

  // Layer precedence (low → high):
  //   scope-extends  <  scope-project  <  scope-local
  // The existing `mergeConfigs` is too broad here (it also resolves
  // `@group` references and re-merges `scopes`), so we use a focused
  // three-way merge that preserves the `regent scopes` preview
  // contract while honouring last-wins for the on-disk layers.
  const onDiskLayer = projectConfig !== null && localConfig !== null
    ? overlayLocal(projectConfig, localConfig)
    : (projectConfig ?? (localConfig as RegentConfig));

  const config = extendsLayer !== null
    ? overlayExtends(extendsLayer, onDiskLayer)
    : onDiskLayer;

  return { config, projectPath, localPath };
}

/**
 * Sentinel error for "scope declared but no config on disk AND no
 * inline `extends`". The caller catches this when it doesn't want to
 * push an empty layer through the merge pipeline.
 *
 * Issue #105: a scope with inline `extends` only — no on-disk
 * `.regentrc.*` — is no longer an error: the inline extends satisfy
 * the "scope declares rules" requirement.
 */
export class ScopeConfigMissingError extends Error {
  readonly scope: ResolvedScope;
  constructor(scope: ResolvedScope) {
    super(
      `scope '${scope.name}' has no config on disk — declared in root config but no .regentrc.* found under '${scope.relativeRoot}' (add a .regentrc.json under that root, or set \`extends: [...]\` inline on the scope spec)`,
    );
    this.name = 'ScopeConfigMissingError';
    this.scope = scope;
  }
}

/**
 * Apply a per-dev local config on top of the project's committed
 * config for this scope. Local overrides project on every field; rule
 * arrays are merged by id (local's id wins), accepted entries are
 * deduped by `(ruleId, path, line)`.
 *
 * This is narrower than `mergeConfigs` because it only combines two
 * files for a single scope — env/args haven't been applied yet. The
 * full layering (defaults, global, env, args) is done by the host's
 * `loadConfig()` once we hand the merged scope config over.
 */
function overlayLocal(project: RegentConfig, local: RegentConfig): RegentConfig {
  return {
    rules: overlayRules(project.rules, local.rules),
    excludePaths: local.excludePaths.length > 0 ? local.excludePaths : project.excludePaths,
    excludeGroups:
      Object.keys(local.excludeGroups).length > 0
        ? { ...project.excludeGroups, ...local.excludeGroups }
        : project.excludeGroups,
    cache: { ...project.cache, ...local.cache },
    log: { ...project.log, ...local.log },
    output: { ...project.output, ...local.output },
    runner: { ...project.runner, ...local.runner },
    scopes: project.scopes,
    ...(project.globalRulesPath !== undefined || local.globalRulesPath !== undefined
      ? { globalRulesPath: local.globalRulesPath ?? project.globalRulesPath }
      : {}),
  };
}

/**
 * Fold a scope's inline `extends` synthetic layer (lowest precedence)
 * with the merged project + local on-disk layer (highest precedence).
 * Issue #105.
 *
 * Only `rules.extends` is concatenated (the inline extends become
 * the *first* entries, so the on-disk layer can override on id
 * conflict). All other fields are taken from the on-disk layer
 * unchanged — inline extends don't carry scalar overrides.
 */
function overlayExtends(
  extendsLayer: RegentConfig,
  onDiskLayer: RegentConfig,
): RegentConfig {
  return {
    ...onDiskLayer,
    rules: {
      ...onDiskLayer.rules,
      extends: [...extendsLayer.rules.extends, ...onDiskLayer.rules.extends],
    },
  };
}

function overlayRules(
  base: RegentConfig['rules'],
  over: RegentConfig['rules'],
): RegentConfig['rules'] {
  const detectById = new Map<string, (typeof base.detect)[number]>();
  for (const r of base.detect) {
    detectById.set(r.id, r);
  }
  for (const r of over.detect) {
    detectById.set(r.id, r);
  }

  const fixById = new Map<string, (typeof base.fix)[number]>();
  for (const r of base.fix) {
    fixById.set(r.id, r);
  }
  for (const r of over.fix) {
    fixById.set(r.id, r);
  }

  const astById = new Map<string, (typeof base.ast)[number]>();
  for (const r of base.ast) {
    astById.set(r.id, r);
  }
  for (const r of over.ast) {
    astById.set(r.id, r);
  }

  const transformById = new Map<string, (typeof base.transform)[number]>();
  for (const r of base.transform) {
    transformById.set(r.id, r);
  }
  for (const r of over.transform) {
    transformById.set(r.id, r);
  }

  const disableSet = new Set<string>([...base.disable, ...over.disable]);

  const overrideMap = new Map<string, (typeof base.override)[string]>();
  for (const [id, ov] of Object.entries(base.override)) {
    overrideMap.set(id, ov);
  }
  for (const [id, ov] of Object.entries(over.override)) {
    overrideMap.set(id, ov);
  }

  const configureMap = new Map<string, unknown>();
  for (const [id, v] of Object.entries(base.configure)) {
    configureMap.set(id, v);
  }
  for (const [id, v] of Object.entries(over.configure)) {
    configureMap.set(id, v);
  }

  const acceptList: (typeof base.accept)[number][] = [];
  const seenAccept = new Set<string>();
  for (const entry of [...base.accept, ...over.accept]) {
    const key = `${entry.ruleId}\u0000${entry.path}\u0000${entry.line ?? ''}`;
    if (seenAccept.has(key)) {
      continue;
    }
    seenAccept.add(key);
    acceptList.push(entry);
  }

  return {
    detect: [...detectById.values()],
    fix: [...fixById.values()],
    ast: [...astById.values()],
    transform: [...transformById.values()],
    extends: [...base.extends, ...over.extends],
    disable: [...disableSet],
    override: Object.fromEntries(overrideMap),
    configure: Object.fromEntries(configureMap),
    accept: acceptList,
  };
}

/**
 * Resolve a scope's `root` against the repo cwd. Exposed for tests
 * and the `regent scopes` command — both share this one implementation
 * to avoid drift.
 */
export function resolveScopeRoot(rawRoot: string, cwd: string): string {
  if (isAbsolute(rawRoot)) {
    return rawRoot;
  }
  return resolve(cwd, rawRoot);
}

/**
 * Confirm a scope's root actually exists on disk. Used by `regent
 * scopes` to flag misconfigured roots (typo, branch not pulled, etc.)
 * without aborting the scan — the runner simply produces zero findings
 * against a missing root.
 */
export function scopeRootExists(scope: ResolvedScope): boolean {
  return existsSync(scope.root);
}

/**
 * Best-effort import of a scope's `.regentrc.*` for `regent scopes
 * <name>` preview mode. Returns the config object (or null if no
 * config file is found). NOT used by the runner pipeline — the
 * loader handles per-scope config via `loadConfig({ cwd: scope.root })`.
 */
export async function tryImportScopeConfig(scope: ResolvedScope): Promise<unknown | null> {
  for (const candidate of [
    `${scope.root}/.regentrc.ts`,
    `${scope.root}/.regentrc.js`,
    `${scope.root}/.regentrc.mjs`,
    `${scope.root}/.regentrc.json`,
  ]) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      const mod = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>;
      return mod.default ?? mod.config ?? mod['regent'] ?? null;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}