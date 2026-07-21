// Loader — reads the merged config from `loadConfig()` and discovers
// rule files. Outputs a flat `LoaderRuleSet` ready for the runner.
//
// Discovery layers (post-merge):
//   1. user-global rule files: `~/.agents/rules/**/*.lint.ts` (or .rule.ts)
//   2. project rule files:    `<cwd>/tools/audit/rules/**/*.lint.ts`
//   3. project inline rules:  `config.rules.detect[]` + `config.rules.fix[]`
//   4. project extends:       `config.rules.extends[]` (paths/globs/inline)
//   5. project disable:       `config.rules.disable[]` (filter applied)
//   6. project override:      `config.rules.override{}` (severity/message)
//   7. project accept:        `config.rules.accept[]` (tri-state review)
//
// v0.2 ships zero built-in rules. Every rule is authored by the user
// or agent. Curated examples live under examples/lang/foo.lint.ts and
// can be pulled in via `extends: 'path-to-example'` or
// `regent example copy`.
//
// Each .lint.ts / .rule.ts file is paired with a sibling .md. The .md
// path is auto-derived into spec.source when not set explicitly.

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig, type CliArgs, type ResolvedConfig } from './config/index.js';
import type { DetectRuleSpec, FixRuleSpec } from './config/schema.js';
import type { AstRuleSpec, CompiledAstRule } from './kinds/ast.js';
import type {
  AcceptEntry,
  CompiledRule,
  RuleOrigin,
  RuleOverride,
  RuleSpec,
  Severity,
} from './types.js';

export interface LoaderOptions {
  /** Repository root (default: process.cwd()). */
  readonly repoRoot?: string;

  /** Skip the per-developer (config.local) layer entirely. */
  readonly skipLocal?: boolean;

  /** Commander-resolved CLI args (highest-precedence overlay). */
  readonly args?: CliArgs;
}

export interface LoaderRuleSet {
  readonly rules: readonly CompiledRule[];
  /** AST-kind rules (ast-grep), run by the runner alongside regex rules. */
  readonly astRules: readonly CompiledAstRule[];
  readonly acceptList: readonly LoadedAcceptEntry[];
  readonly resolvedConfig: ResolvedConfig;
  readonly totalSourceLayers: number;
}

export type LoadedAcceptEntry = AcceptEntry & {
  readonly origin: 'repo' | 'local';
};

/**
 * Public entry point. Resolves the layered config via `loadConfig()`,
 * then discovers + applies rule files and inline rules.
 */
export async function loadRules(options: LoaderOptions): Promise<LoaderRuleSet> {
  const cwd = options.repoRoot ?? process.cwd();

  const { config, sources } = await loadConfig({ cwd, args: options.args });

  const allRules: CompiledRule[] = [];
  const fileAstRules: CompiledAstRule[] = [];
  const seen = new Set<string>();

  // 1. User-global rule files
  const userGlobalRoot = join(
    process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~/.agents',
    '.agents',
    'rules',
  );
  if (existsSync(userGlobalRoot)) {
    for (const r of await loadRuleFilesUnder(userGlobalRoot, 'global')) {
      if (!seen.has(r.spec.id)) {
        allRules.push(r);
        seen.add(r.spec.id);
      }
    }
    fileAstRules.push(...await loadAstRuleFilesUnder(userGlobalRoot, 'global'));
  }

  // 2. Project-local rule files in tools/audit/rules/
  const repoRulesDir = join(cwd, 'tools', 'audit', 'rules');
  if (existsSync(repoRulesDir)) {
    for (const r of await loadRuleFilesUnder(repoRulesDir, 'repo')) {
      if (!seen.has(r.spec.id)) {
        allRules.push(r);
        seen.add(r.spec.id);
      }
    }
    fileAstRules.push(...await loadAstRuleFilesUnder(repoRulesDir, 'repo'));
  }

  // 3. Inline rules from config.rules.detect[] and rules.fix[]
  for (const spec of config.rules.detect) {
    if (!seen.has(spec.id)) {
      allRules.push({
        spec,
        source: spec.source ?? '<inline>',
        origin: { kind: 'repo', path: cwd },
      });
      seen.add(spec.id);
    }
  }
  for (const spec of config.rules.fix) {
    if (!seen.has(spec.id)) {
      allRules.push({
        spec: specToDetectShape(spec),
        source: '<inline>',
        origin: { kind: 'repo', path: cwd },
      });
      seen.add(spec.id);
    }
  }

  // 3b. AST rules — discovered from files (user-global + repo), then inline
  // config.rules.ast[]. File-discovered rules win on id (first-seen).
  const astRules: CompiledAstRule[] = [];
  const astSeen = new Set<string>();
  for (const r of fileAstRules) {
    if (astSeen.has(r.spec.id) || config.rules.disable.includes(r.spec.id)) {
      continue;
    }
    astRules.push(r);
    astSeen.add(r.spec.id);
  }
  for (const raw of config.rules.ast) {
    const spec = raw as unknown as AstRuleSpec;
    if (astSeen.has(spec.id) || config.rules.disable.includes(spec.id)) {
      continue;
    }
    astRules.push({
      spec,
      source: spec.source ?? '<inline>',
      origin: { kind: 'repo', path: cwd },
    });
    astSeen.add(spec.id);
  }
  for (const [id, ov] of Object.entries(config.rules.override)) {
    const idx = astRules.findIndex((r) => r.spec.id === id);
    if (idx !== -1) {
      const existing = astRules[idx]!;
      const o = ov as RuleOverride;
      astRules[idx] = {
        ...existing,
        spec: {
          ...existing.spec,
          severity: o.severity ?? existing.spec.severity,
          message: o.message ?? existing.spec.message,
        },
      };
    }
  }

  // 4. Extends — paths/globs/inline arrays
  for (const ext of config.rules.extends as readonly (string | readonly unknown[])[]) {
    const extended = await resolveExtendsItem(ext, cwd);
    for (const r of extended) {
      if (!seen.has(r.spec.id)) {
        allRules.push(r);
        seen.add(r.spec.id);
      }
    }
  }

  // 5. Disable — remove by id
  for (const id of config.rules.disable) {
    const idx = allRules.findIndex((r) => r.spec.id === id);
    if (idx !== -1) {
      allRules.splice(idx, 1);
      seen.delete(id);
    }
  }

  // 6. Override — apply severity/message per id
  for (const [id, ov] of Object.entries(config.rules.override)) {
    const idx = allRules.findIndex((r) => r.spec.id === id);
    if (idx === -1) {
      continue;
    }
    const existing = allRules[idx]!;
    allRules[idx] = {
      ...existing,
      spec: applyOverride(existing.spec, ov as RuleOverride),
    };
  }

  // 7. Accept-list for tri-state review
  const acceptList: LoadedAcceptEntry[] = config.rules.accept.map((entry) => ({
    ...entry,
    origin: 'repo' as const,
  }));

  return {
    rules: allRules,
    astRules,
    acceptList,
    resolvedConfig: config,
    totalSourceLayers:
      1 + // defaults
      (sources.global ? 1 : 0) +
      (sources.project ? 1 : 0) +
      (sources.local ? 1 : 0) +
      (sources.env ? 1 : 0) +
      (sources.args ? 1 : 0),
  };
}

// ---------------------------------------------------------------------------
// Internal: rule-file discovery + spec import
// ---------------------------------------------------------------------------

function isDetectRuleSpec(value: unknown): value is DetectRuleSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj['id'] === 'string'
    && typeof obj['severity'] === 'string'
    && typeof obj['pattern'] === 'string'
    && Array.isArray(obj['globs']);
}

function isAstRuleSpec(value: unknown): value is AstRuleSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj['id'] === 'string'
    && typeof obj['language'] === 'string'
    && typeof obj['severity'] === 'string'
    && Array.isArray(obj['globs'])
    && typeof obj['ast'] === 'object'
    && obj['ast'] !== null;
}

async function loadAstRuleFilesUnder(
  root: string,
  kind: Exclude<RuleOrigin['kind'], 'preset'>,
): Promise<CompiledAstRule[]> {
  if (!existsSync(root)) {
    return [];
  }
  const { glob } = await import('tinyglobby');
  const matches = await glob('**/*.{lint,rule}.ts', {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  });
  const rules: CompiledAstRule[] = [];
  for (const absPath of matches) {
    const spec = await importAstRuleFile(absPath);
    if (spec === undefined) {
      continue;
    }
    const baseName = absPath.replace(/\.(lint|rule)\.ts$/, '');
    const siblingMd = `${baseName}.md`;
    const source = spec.source ?? (existsSync(siblingMd) ? siblingMd : absPath);
    rules.push({ spec, source, origin: { kind, path: absPath } });
  }
  return rules;
}

async function importAstRuleFile(absPath: string): Promise<AstRuleSpec | undefined> {
  try {
    const url = pathToFileURL(absPath).href;
    const mod = await import(url);
    if (isAstRuleSpec(mod.default)) {
      return mod.default;
    }
    if (isAstRuleSpec(mod.rule)) {
      return mod.rule;
    }
    for (const key of Object.keys(mod)) {
      if (isAstRuleSpec(mod[key])) {
        return mod[key];
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function loadRuleFilesUnder(
  root: string,
  kind: Exclude<RuleOrigin['kind'], 'preset'>,
): Promise<CompiledRule[]> {
  if (!existsSync(root)) {
    return [];
  }
  const { glob } = await import('tinyglobby');
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
    if (isDetectRuleSpec(mod.default)) {
      return mod.default;
    }
    if (isDetectRuleSpec(mod.rule)) {
      return mod.rule;
    }
    for (const key of Object.keys(mod)) {
      if (isDetectRuleSpec(mod[key])) {
        return mod[key];
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function resolveExtendsItem(
  item: string | readonly unknown[],
  cwd: string,
): Promise<CompiledRule[]> {
  if (typeof item !== 'string') {
    // Treat as inline rule array.
    const out: CompiledRule[] = [];
    for (const spec of item) {
      if (isDetectRuleSpec(spec)) {
        out.push({
          spec,
          source: spec.source ?? 'extends (inline)',
          origin: { kind: 'repo', path: cwd },
        });
      }
    }
    return out;
  }

  if (item.startsWith('@dot-stbl/regent/presets/')) {
    throw new Error(
      `regent: built-in presets are removed in v0.2 — '${item}' is no longer valid. `
      + `Use \`regent llm examples <lang>\` to find curated rules, or \`extends: '<path-to-example>'\` to load them.`,
    );
  }

  const abs = resolvePath(item, cwd);
  if (!existsSync(abs)) {
    return [];
  }
  const stat = statSync(abs);

  if (stat.isFile() && (abs.endsWith('.rule.ts') || abs.endsWith('.lint.ts'))) {
    const spec = await importRuleFile(abs);
    if (spec) {
      return [{
        spec,
        source: spec.source ?? abs,
        origin: { kind: 'repo', path: abs },
      }];
    }
    return [];
  }

  if (stat.isDirectory()) {
    return loadRuleFilesUnder(abs, 'repo');
  }

  // glob pattern
  const { glob } = await import('tinyglobby');
  const globPattern = abs.endsWith('/**') ? `${abs}/*.{lint,rule}.ts` : abs;
  const matches = await glob(globPattern, {
    absolute: true,
    onlyFiles: true,
  });
  const out: CompiledRule[] = [];
  for (const match of matches) {
    if (match.endsWith('.rule.ts') || match.endsWith('.lint.ts')) {
      const spec = await importRuleFile(match);
      if (spec) {
        out.push({
          spec,
          source: spec.source ?? match,
          origin: { kind: 'repo', path: match },
        });
      }
    } else if (statSync(match).isDirectory()) {
      out.push(...await loadRuleFilesUnder(match, 'repo'));
    }
  }
  return out;
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

function applyOverride(spec: RuleSpec, override: RuleOverride): RuleSpec {
  return {
    ...spec,
    severity: (override.severity ?? spec.severity) as Severity,
    message: override.message ?? spec.message,
  };
}

/**
 * Bridge: a v0.2 fix rule needs to fit the existing CompiledRule
 * envelope (which carries a `pattern`). Until the runner learns to
 * dispatch on `kind === 'fix'`, fix rules are surfaced through the
 * detect path with a synthetic pattern derived from `find`.
 */
function specToDetectShape(spec: FixRuleSpec): RuleSpec {
  return {
    id: spec.id,
    severity: spec.severity,
    pattern: spec.find,
    globs: spec.globs,
    ...(spec.excludePaths !== undefined ? { excludePaths: spec.excludePaths } : {}),
    message: spec.message,
    ...(spec.dependsOn !== undefined ? { dependsOn: spec.dependsOn } : {}),
    // Marker for future runner dispatch.
    ...({
      kind: 'fix' as const,
      find: spec.find,
      replace: spec.replace,
      ...(spec.all !== undefined ? { all: spec.all } : {}),
    } as unknown as { kind: 'fix' }),
  } as unknown as RuleSpec;
}