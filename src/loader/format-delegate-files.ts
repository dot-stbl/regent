// #34c — file-based discovery for `defineFormat` / `defineDelegate` specs.
//
// Symmetrical to `loadAstRuleFilesUnder` / `loadTransformRuleFilesUnder`
// in `loader.ts`: scan a directory for `*.format.ts` / `*.delegate.ts`
// files, dynamic-import each, narrow to the spec shape via the type
// predicates below, and return the materialised list.
//
// Discovery roots:
//   1. user-global — `~/.agents/rules/` (overridable via
//      `STBL_REGENT_GLOBAL_RULES_PATH` for tests / sandboxed runs).
//   2. project — `<cwd>/tools/audit/` (NOT `tools/audit/rules/` — the
//      spec file lives one level up from the rule files so the user
//      can tell format / delegate specs apart from rule files at a
//      glance; see CONTRIBUTING §"File-based discovery").
//
// The static type predicates are runtime-narrowers for the author-side
// shape; Zod (`FormatRuleSpecSchema` / `DelegateRuleSpecSchema` in
// `config/schema.ts`) is the inline-config equivalent and reuses the
// same shape contract.
//
// Spec authors who want to ship a bundle can publish an npm package
// with a default / named export — see `src/loader/plugin-extends.ts`
// for the resolution path.

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { z } from 'zod';

import type { DelegateRuleSpec } from '../kinds/delegate.js';
import type { FormatRuleSpec } from '../kinds/format.js';

/**
 * Minimum shape of a loadable `defineFormat` export. The presence of
 * `id` + `severity` + `detect` (string[] OR function) + `normalize`
 * (function) + optional `params` distinguishes a format spec from
 * any other rule kind — patterns, AST, etc. — without a runtime
 * `instanceof` check.
 *
 * Mirrors `isDetectRuleSpec` / `isAstRuleSpec` in `loader.ts` — same
 * predicate family, different spec shape. Bundles export the typed
 * `FormatRuleSpec` directly; this predicate widens for the loader's
 * narrow + cast pipeline.
 */
function isFormatRuleSpec(value: unknown): value is FormatRuleSpec<z.ZodTypeAny> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj['id'] !== 'string') {
    return false;
  }
  if (typeof obj['severity'] !== 'string') {
    return false;
  }
  // `detect` must be `string[]` (read form) or `function` (parameterised).
  if (Array.isArray(obj['detect'])) {
    if (!(obj['detect'] as unknown[]).every((s) => typeof s === 'string')) {
      return false;
    }
  } else if (typeof obj['detect'] !== 'function') {
    return false;
  }
  // `fix` is optional; when present, same shape contract as `detect`.
  if (obj['fix'] !== undefined) {
    if (Array.isArray(obj['fix'])) {
      if (!(obj['fix'] as unknown[]).every((s) => typeof s === 'string')) {
        return false;
      }
    } else if (typeof obj['fix'] !== 'function') {
      return false;
    }
  }
  // `normalize` is a runtime function; the loader casts the
  // zod-unknown to a Normalize at the runner boundary.
  if (typeof obj['normalize'] !== 'function') {
    return false;
  }
  return true;
}

/**
 * Minimum shape of a loadable `defineDelegate` export. Same as
 * `isFormatRuleSpec` minus the `fix` field — delegates are
 * observational.
 */
function isDelegateRuleSpec(value: unknown): value is DelegateRuleSpec<z.ZodTypeAny> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj['id'] !== 'string') {
    return false;
  }
  if (typeof obj['severity'] !== 'string') {
    return false;
  }
  if (Array.isArray(obj['detect'])) {
    if (!(obj['detect'] as unknown[]).every((s) => typeof s === 'string')) {
      return false;
    }
  } else if (typeof obj['detect'] !== 'function') {
    return false;
  }
  if (typeof obj['normalize'] !== 'function') {
    return false;
  }
  return true;
}

export interface LoadedSpecMeta {
  /** Absolute path of the source file (for SARIF `helpUri`). */
  readonly path: string;
  /** Sibling `.md` if it exists, otherwise the `.ts` path itself. */
  readonly source: string;
}

/**
 * Tuple result for `loadFormatSpecFilesUnder` / `loadDelegateSpecFilesUnder`.
 * Each loader returns the spec list paired with its source path so the
 * caller can build the `LoaderRuleSet.formatSpecs` /
 * `LoaderRuleSet.delegateSpecs` entries (id + spec + provenance).
 */
export type LoadedSpecs<TSpec> = ReadonlyArray<{
  readonly spec: TSpec;
  readonly meta: LoadedSpecMeta;
}>;

/**
 * Scan `root` for `*.format.ts` files, dynamic-import each, narrow
 * via `isFormatRuleSpec`. Files that fail to import or don't export
 * a format-spec shape are silently skipped — same convention as
 * `loadAstRuleFilesUnder`.
 *
 * A non-existent `root` is a no-op (returns `[]`) — callers don't
 * have to pre-check existence.
 */
export async function loadFormatSpecFilesUnder(
  root: string,
): Promise<LoadedSpecs<FormatRuleSpec<z.ZodTypeAny>>> {
  if (!existsSync(root)) {
    return [];
  }
  const { glob } = await import('tinyglobby');
  const matches = await glob('**/*.format.ts', {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  });
  const out: Array<{ spec: FormatRuleSpec<z.ZodTypeAny>; meta: LoadedSpecMeta }> = [];
  for (const absPath of matches) {
    const spec = await importFormatSpecFile(absPath);
    if (spec === undefined) {
      continue;
    }
    const baseName = absPath.replace(/\.format\.ts$/, '');
    const siblingMd = `${baseName}.md`;
    const source = spec.source ?? (existsSync(siblingMd) ? siblingMd : absPath);
    out.push({ spec, meta: { path: absPath, source } });
  }
  return out;
}

/**
 * Scan `root` for `*.delegate.ts` files. Symmetric to
 * `loadFormatSpecFilesUnder`.
 */
export async function loadDelegateSpecFilesUnder(
  root: string,
): Promise<LoadedSpecs<DelegateRuleSpec<z.ZodTypeAny>>> {
  if (!existsSync(root)) {
    return [];
  }
  const { glob } = await import('tinyglobby');
  const matches = await glob('**/*.delegate.ts', {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  });
  const out: Array<{ spec: DelegateRuleSpec<z.ZodTypeAny>; meta: LoadedSpecMeta }> = [];
  for (const absPath of matches) {
    const spec = await importDelegateSpecFile(absPath);
    if (spec === undefined) {
      continue;
    }
    const baseName = absPath.replace(/\.delegate\.ts$/, '');
    const siblingMd = `${baseName}.md`;
    const source = spec.source ?? (existsSync(siblingMd) ? siblingMd : absPath);
    out.push({ spec, meta: { path: absPath, source } });
  }
  return out;
}

async function importFormatSpecFile(
  absPath: string,
): Promise<FormatRuleSpec<z.ZodTypeAny> | undefined> {
  try {
    const url = pathToFileURL(absPath).href;
    const mod = await import(url);
    return pickFormatSpecExport(mod);
  } catch {
    return undefined;
  }
}

async function importDelegateSpecFile(
  absPath: string,
): Promise<DelegateRuleSpec<z.ZodTypeAny> | undefined> {
  try {
    const url = pathToFileURL(absPath).href;
    const mod = await import(url);
    return pickDelegateSpecExport(mod);
  } catch {
    return undefined;
  }
}

/**
 * Walk a module's exports looking for a loadable format-spec
 * shape. Mirrors `importRuleFile`'s default → rule → rest-of-named
 * lookup so locally-authored spec files and bundle-published
 * specs follow the same resolution order.
 *
 * The `__kind: 'format'` marker (attached by `defineFormat`)
 * breaks the tie when a delegate spec without `fix` matches
 * both predicates. Without the marker, a structural-only check
 * routes delegate-shaped exports into the format array.
 */
function pickFormatSpecExport(
  mod: Record<string, unknown>,
): FormatRuleSpec<z.ZodTypeAny> | undefined {
  if (isFormatSpec(mod['default'])) {
    return mod['default'];
  }
  if (
    isFormatSpec(mod['rule'])
    && mod['rule'] !== mod['default']
  ) {
    return mod['rule'];
  }
  for (const key of Object.keys(mod)) {
    if (key === 'default' || key === 'rule') {
      continue;
    }
    if (isFormatSpec(mod[key])) {
      return mod[key];
    }
  }
  return undefined;
}

function pickDelegateSpecExport(
  mod: Record<string, unknown>,
): DelegateRuleSpec<z.ZodTypeAny> | undefined {
  if (isDelegateSpecExport(mod['default'])) {
    return mod['default'];
  }
  if (
    isDelegateSpecExport(mod['rule'])
    && mod['rule'] !== mod['default']
  ) {
    return mod['rule'];
  }
  for (const key of Object.keys(mod)) {
    if (key === 'default' || key === 'rule') {
      continue;
    }
    if (isDelegateSpecExport(mod[key])) {
      return mod[key];
    }
  }
  return undefined;
}

/**
 * Spec-shape predicate that respects the `__kind` marker. Used by
 * the file-discovery picker so a delegate-shaped spec from a
 * single-export `.format.ts` file (a common mistake — author
 * chose the wrong extension) doesn't get mis-routed into
 * `formatSpecs`.
 */
function isFormatSpec(value: unknown): value is FormatRuleSpec<z.ZodTypeAny> {
  if (!isFormatRuleSpec(value)) {
    return false;
  }
  const kind = (value as { __kind?: string }).__kind;
  // A `__kind: 'delegate'` marker overrides the shape match.
  return kind !== 'delegate';
}

// Re-export the predicates for callers that want to narrow inline
// config (rare — schema-based config goes through zod).
export const __testOnly = {
  isFormatRuleSpec,
  isDelegateRuleSpec: isDelegateSpecExport,
};

/**
 * Internal predicate for the named-export path. The public
 * `isDelegateRuleSpec` lives next to the format predicate (same
 * naming convention as `isFormatRuleSpec`); the named-export lookup
 * uses this alias so the export-list comprehension reads
 * symmetrically.
 */
function isDelegateSpecExport(
  value: unknown,
): value is DelegateRuleSpec<z.ZodTypeAny> {
  return isDelegateRuleSpec(value);
}
