// Loader — merges the discovery layers into a single rule set.
//
// Layers (low to high priority; top wins):
//   1. User-global: HOME/.agents/rules (auto-loaded; legacy + new files)
//   2. Repository: tools/audit/config.ts and tools/audit/rules/
//   3. Per-developer: tools/audit/config.local.ts (gitignored)
//
// regent ships zero built-in rules. Every rule is authored by the user
// or agent. Curated examples live under examples/lang/foo.lint.ts and
// can be pulled in via extends: 'path-to-example' or
// 'regent example copy <lang> <rule-id>'.
//
// Each .lint.ts / .rule.ts file is paired with a sibling .md. The .md
// path is auto-derived into spec.source when not set explicitly.
//
// The loader does NOT execute rules — see runner.ts.

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, dirname as pathDirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  AcceptEntry,
  CompiledRule,
  ConfigLayer,
  RuleOrigin,
  RuleOverride,
  RuleSpec,
  Severity,
} from './types.js';

const DEFAULT_EXCLUDE_PATHS: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/bin/**',
  '**/obj/**',
  '**/.git/**',
];

export interface LoaderOptions {
  /** User-global root (default: `$HOME/.agents/rules`). */
  readonly userGlobalRoot?: string;

  /** Repository root containing `tools/audit/`. */
  readonly repoRoot: string;

  /** Skip the per-developer (config.local.ts) layer entirely. */
  readonly skipLocal?: boolean;
}

export interface LoaderRuleSet {
  readonly rules: readonly CompiledRule[];
  /**
   * Merged accept-list (Layer 3 repo + Layer 4 local). Layer 4 entries
   * are appended additively — devs can extend the team's accept-list
   * without modifying committed config.
   */
  readonly acceptList: readonly LoadedAcceptEntry[];
  readonly totalSourceLayers: number;
}

/**
 * Runtime-extended accept entry — carries the source layer so the
 * `regent review --include-accepted` audit output can attribute each
 * accept to repo vs local.
 */
export type LoadedAcceptEntry = AcceptEntry & {
  readonly origin: 'repo' | 'local';
};

/**
 * Public entry point. Reads the configured layers, merges them, returns
 * the final rule set + accumulated accept-list.
 */
export async function loadRules(options: LoaderOptions): Promise<LoaderRuleSet> {
  const allRules: CompiledRule[] = [];
  const seen = new Set<string>();
  const acceptList: LoadedAcceptEntry[] = [];
  const layers = 0;

  // Layer 1 — user-global (no built-in presets; regent ships zero rules)
  const userGlobalRoot = options.userGlobalRoot
    ?? join(process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~/.agents', '.agents', 'rules');
  if (existsSync(userGlobalRoot)) {
    const globalRules = await loadRuleFilesUnder(userGlobalRoot, 'global');
    for (const rule of globalRules) {
      if (!seen.has(rule.spec.id)) {
        allRules.push(rule);
        seen.add(rule.spec.id);
      }
    }
  }

  // Layer 3 — repository
  const repoAuditDir = join(options.repoRoot, 'tools', 'audit');
  let repoLayerAdded = false;
  if (existsSync(repoAuditDir)) {
    const repoConfigPath = resolveConfigPath(repoAuditDir, 'config');
    const repoConfig = repoConfigPath ? await loadConfigFromPath(repoConfigPath) : null;

    // Repo rules subdirectory
    const repoRulesDir = join(repoAuditDir, 'rules');
    if (existsSync(repoRulesDir)) {
      const repoRules = await loadRuleFilesUnder(repoRulesDir, 'repo');
      for (const rule of repoRules) {
        if (!seen.has(rule.spec.id)) {
          allRules.push(rule);
          seen.add(rule.spec.id);
        }
      }
    }

    // Repo config: extends + add/override/disable + accept
    if (repoConfig) {
      const extendedRules = await resolveExtends(repoConfig.extends ?? [], options.repoRoot);
      for (const rule of extendedRules) {
        if (!seen.has(rule.spec.id)) {
          allRules.push(rule);
          seen.add(rule.spec.id);
        }
      }
      applyConfigOptions(allRules, seen, repoConfig, 'repo', repoConfigPath!);
      for (const entry of repoConfig.rules?.accept ?? []) {
        acceptList.push(Object.assign({}, entry, { origin: 'repo' as const }));
      }
    }

    if (existsSync(repoRulesDir) || repoConfig !== null) {
      repoLayerAdded = true;
    }
  }

  // Layer 4 — per-developer (gitignored)
  if (!options.skipLocal) {
    const localConfigPath = resolveConfigPath(repoAuditDir, 'config.local');
    if (localConfigPath) {
      const localConfig = await loadConfigFromPath(localConfigPath);
      if (localConfig) {
        applyConfigOptions(allRules, seen, localConfig, 'local', localConfigPath);
        for (const entry of localConfig.rules?.accept ?? []) {
          acceptList.push(Object.assign({}, entry, { origin: 'local' as const }));
        }
      }
    }
  }

  void layers;

  return {
    rules: allRules,
    acceptList,
    totalSourceLayers: 1 + (existsSync(userGlobalRoot) ? 1 : 0) + (repoLayerAdded ? 1 : 0),
  };
}

function isRuleSpec(value: unknown): value is RuleSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj['id'] === 'string'
    && typeof obj['severity'] === 'string'
    && typeof obj['pattern'] === 'string'
    && Array.isArray(obj['globs']);
}

async function loadRuleFilesUnder(
  root: string,
  kind: Exclude<RuleOrigin['kind'], 'preset'>,
): Promise<CompiledRule[]> {
  if (!existsSync(root)) {
    return [];
  }
  const { glob } = await import('tinyglobby');
  // v0.2: discover both legacy `.rule.ts` and the new `.lint.ts` (detect).
  // Fix rules (`.fix.ts`) and transforms (`.transform.ts`) are added in
  // later phases — for now Phase 1 only handles `.lint.ts` / `.rule.ts`.
  const matches = await glob('**/*.{lint,rule}.ts', {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  });

  const rules: CompiledRule[] = [];
  for (const absPath of matches) {
    const spec = await importRuleFile(absPath);
    if (spec === undefined) {
      continue;
    }
    // Strip either `.lint.ts` or `.rule.ts` to find the sibling `.md`.
    const baseName = absPath.replace(/\.(lint|rule)\.ts$/, '');
    const siblingMd = `${baseName}.md`;
    const source = spec.source ?? (existsSync(siblingMd) ? siblingMd : absPath);
    rules.push({
      spec,
      source,
      origin: { kind, path: absPath },
    });
  }
  return rules;
}

async function importRuleFile(absPath: string): Promise<RuleSpec | undefined> {
  try {
    const url = pathToFileURL(absPath).href;
    const mod = await import(url);
    if (isRuleSpec(mod.default)) {
      return mod.default;
    }
    if (isRuleSpec(mod.rule)) {
      return mod.rule;
    }
    for (const key of Object.keys(mod)) {
      if (isRuleSpec(mod[key])) {
        return mod[key];
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function loadConfigFromPath(path: string): Promise<ConfigLayer | null> {
  if (!existsSync(path)) {
    return null;
  }
  const stat = statSync(path);
  if (!stat.isFile()) {
    return null;
  }
  try {
    const url = pathToFileURL(path).href;
    const mod = await import(url);
    const candidate = mod.default ?? mod.config;
    if (candidate && typeof candidate === 'object') {
      return candidate as ConfigLayer;
    }
  } catch (err) {
    console.error(`regent: failed to load config at ${path}: ${(err as Error).message}`);
    return null;
  }
  return null;
}

async function resolveExtends(
  extendsList: readonly (string | readonly RuleSpec[])[],
  repoRoot: string,
): Promise<CompiledRule[]> {
  const rules: CompiledRule[] = [];
  for (const item of extendsList) {
    if (Array.isArray(item)) {
      for (const spec of item) {
        if (isRuleSpec(spec)) {
          rules.push({
            spec,
            source: spec.source ?? 'extends (inline)',
            origin: { kind: 'repo', path: repoRoot },
          });
        }
      }
      continue;
    }
    if (typeof item !== 'string') {
      continue;
    }

    if (item.startsWith('@dot-stbl/regent/presets/')) {
      // regent v0.2 removed all built-in presets. Surface a clear error
      // instead of silently loading nothing.
      throw new Error(
        `regent: built-in presets are removed in v0.2 — '${item}' is no longer valid. `
        + `Use \`regent llm examples <lang>\` to find curated rules, or \`extends: '<path-to-example>'\` to load them.`,
      );
    }

    const abs = resolvePath(item, repoRoot);
    if (!existsSync(abs)) {
      continue;
    }
    const stat = statSync(abs);

    if (stat.isFile() && (abs.endsWith('.rule.ts') || abs.endsWith('.lint.ts'))) {
      const spec = await importRuleFile(abs);
      if (spec) {
        rules.push({
          spec,
          source: spec.source ?? abs,
          origin: { kind: 'repo', path: abs },
        });
      }
      continue;
    }

    if (stat.isDirectory()) {
      rules.push(...await loadRuleFilesUnder(abs, 'repo'));
      continue;
    }

    // glob pattern — accept both extensions
    const { glob } = await import('tinyglobby');
    const globPattern = abs.endsWith('/**') ? abs + '/*.{lint,rule}.ts' : abs;
    const matches = await glob(globPattern, {
      absolute: true,
      onlyFiles: true,
    });
    for (const match of matches) {
      if (match.endsWith('.rule.ts') || match.endsWith('.lint.ts')) {
        const spec = await importRuleFile(match);
        if (spec) {
          rules.push({
            spec,
            source: spec.source ?? match,
            origin: { kind: 'repo', path: match },
          });
        }
      } else if (statSync(match).isDirectory()) {
        rules.push(...await loadRuleFilesUnder(match, 'repo'));
      }
    }
  }
  return rules;
}

function resolvePath(p: string, repoRoot: string): string {
  if (p.startsWith('~')) {
    const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
    return p.replace('~', home);
  }
  if (isAbsolute(p)) {
    return p;
  }
  return resolve(repoRoot, p);
}

function applyConfigOptions(
  rules: CompiledRule[],
  seen: Set<string>,
  config: ConfigLayer,
  kind: Exclude<RuleOrigin['kind'], 'preset'>,
  configPath: string,
): void {
  // Order matters: add must run BEFORE disable/override so that rules
  // defined in this config layer can be referenced by them. (Earlier
  // versions processed disable/override first, which silently no-op'd
  // any disable/override targeting an `add` rule.)
  for (const spec of config.rules?.add ?? []) {
    if (!isRuleSpec(spec)) {
      continue;
    }
    if (seen.has(spec.id)) {
      continue;
    }
    rules.push({
      spec,
      source: spec.source ?? configPath,
      origin: { kind, path: configPath },
    });
    seen.add(spec.id);
  }
  for (const id of config.rules?.disable ?? []) {
    const idx = rules.findIndex((r) => r.spec.id === id);
    if (idx !== -1) {
      rules.splice(idx, 1);
      seen.delete(id);
    }
  }
  for (const [id, override] of Object.entries(config.rules?.override ?? {})) {
    const idx = rules.findIndex((r) => r.spec.id === id);
    if (idx === -1) {
      continue;
    }
    const existing = rules[idx]!;
    rules[idx] = {
      ...existing,
      spec: applyOverride(existing.spec, override),
    };
  }
}

function applyOverride(spec: RuleSpec, override: RuleOverride): RuleSpec {
  return {
    ...spec,
    severity: (override.severity ?? spec.severity) as Severity,
    message: override.message ?? spec.message,
    excludePaths: spec.excludePaths
      ? mergeExcludePaths(spec.excludePaths, DEFAULT_EXCLUDE_PATHS)
      : DEFAULT_EXCLUDE_PATHS,
  };
}

function mergeExcludePaths(
  base: readonly string[],
  defaults: readonly string[],
): readonly string[] {
  const out = new Set<string>([...defaults, ...base]);
  return [...out];
}

/**
 * Look up a `tools/audit/<name>.ts` or `<name>.js` config. Returns the
 * first existing match. Allows tests + lightweight installs to use plain
 * `.js` configs (no TypeScript transpile).
 */
function resolveConfigPath(auditDir: string, baseName: string): string | null {
  for (const ext of ['.ts', '.mts', '.js', '.mjs']) {
    const candidate = join(auditDir, baseName + ext);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Re-export pathDirname for tests if needed
export { pathDirname };
