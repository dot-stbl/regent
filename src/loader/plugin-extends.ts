// Plugin resolution for `extends: '@scope/name'` (#23 + #34c).
//
// Splits the npm-shaped extends branch out of `loader.ts` so the main
// file stays in the ~600-line range that the codebase already had.
// Pure logic: a regex check + a dynamic-import wrapper. No state.
//
// #34c adds format / delegate spec resolution alongside the detect-
// rule path. A bundle like `@scope/regent-format-dotnet` exports a
// `defineFormat` spec; `extends: '@scope/regent-format-dotnet'`
// returns a `FormatRuleSpec` (not a `CompiledRule`). Bundles can
// mix shapes — a single package can export a rule AND a format
// spec; the lookup walks every export and feeds each into the
// right loader pipeline via the discriminator in
// `ResolvedExtendsBundle`.

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { z } from 'zod';

import type { DelegateRuleSpec } from '../kinds/delegate.js';
import type { FormatRuleSpec } from '../kinds/format.js';
import type {
  ParameterizedRuleSpec,
} from '../kinds/parameterized.js';
import type { CompiledRule, RuleSpec } from '../types.js';

/**
 * Type predicate for a loadable rule shape exposed by a plugin
 * (`default` / `rule` / named export). Accepts both `RuleSpec`
 * (the static-string form used by `defineDetectRule`) and the
 * `ParameterizedRuleSpec` shape used by `defineParameterizedRule`
 * (function-typed `pattern` paired with `params`) — discriminated
 * by the `params` field. Both flow through the loader's
 * materialisation step (parameterised) or pass through unchanged
 * (static).
 *
 * Mirrors the `isDetectRuleSpec` predicate inside `loader.ts`;
 * kept here because the plugin path (#23) owns its own type
 * narrowing and should not depend on `loader.ts`'s internals.
 */
function isLoadableRuleSpec(
  value: unknown,
): value is RuleSpec | ParameterizedRuleSpec<z.ZodTypeAny> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj['id'] !== 'string' || typeof obj['severity'] !== 'string') {
    return false;
  }
  if (!Array.isArray(obj['globs'])) {
    return false;
  }
  // Parameterized — has `params`; `pattern` is string or function.
  if (obj['params'] !== undefined) {
    return true;
  }
  // Static — `pattern` must be a string (no function-form without
  // `params`; that's the parameterised case the other branch owns).
  return typeof obj['pattern'] === 'string';
}

/**
 * #34c — predicate for `defineFormat` exports. Mirrors the inline-
 * config shape in `src/loader/format-delegate-files.ts` (kept
 * duplicated here so the plugin path owns its own narrowing). The
 * bundle author ships the typed `FormatRuleSpec` directly; the
 * predicate widens for the loader's narrow + cast pipeline.
 */
function isFormatRuleSpecExport(
  value: unknown,
): value is FormatRuleSpec<z.ZodTypeAny> {
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
  if (obj['fix'] !== undefined) {
    if (Array.isArray(obj['fix'])) {
      if (!(obj['fix'] as unknown[]).every((s) => typeof s === 'string')) {
        return false;
      }
    } else if (typeof obj['fix'] !== 'function') {
      return false;
    }
  }
  if (typeof obj['normalize'] !== 'function') {
    return false;
  }
  return true;
}

/**
 * #34c — predicate for `defineDelegate` exports. Same as
 * `isFormatRuleSpecExport` minus the optional `fix` field.
 */
function isDelegateRuleSpecExport(
  value: unknown,
): value is DelegateRuleSpec<z.ZodTypeAny> {
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

/**
 * Pattern matches an npm package spec of the form `@scope/name[/subpath]`.
 * Bare unprefixed `name` is intentionally NOT recognised — that's the
 * historical preset-confusion footgun; users can disambiguate with
 * `./name` for a local path.
 */
export const NPM_PACKAGE_PATTERN = /^@[^/]+\/[^/]+(?:\/.*)?$/;

export function isNpmPackageSpec(item: string): boolean {
  return NPM_PACKAGE_PATTERN.test(item);
}

/**
 * #34c — result of a bundle resolution. A single package can ship
 * any combination of: detect rules, format specs, delegate specs.
 * Each is fed into the corresponding loader pipeline by `loader.ts`.
 */
export interface ResolvedExtendsBundle {
  readonly rules: readonly CompiledRule[];
  readonly formatSpecs: readonly FormatRuleSpec<z.ZodTypeAny>[];
  readonly delegateSpecs: readonly DelegateRuleSpec<z.ZodTypeAny>[];
}

/**
 * Resolve `extends: '@scope/name'` by dynamic-importing the npm
 * package. The package must export at least one rule or spec
 * shape — a `default` export (single spec or array), a `rule`
 * export, or any named export whose value matches one of the
 * `isLoadableRuleSpec` / `isFormatRuleSpecExport` /
 * `isDelegateRuleSpecExport` discriminators. Mirrors the lookup
 * order used for local rule files so the two paths stay symmetric.
 *
 * Resolution is anchored at *this module's* URL — NOT the call
 * site. Vitest's in-memory TS transform rewrites `import(spec)` to
 * a call relative to the test file, which in monorepo / test runs
 * skips the project's `node_modules`. `createRequire(import.meta.url)`
 * always anchors resolution against `loader.ts` (or `dist/loader.js`
 * in production), where the project's `node_modules` is reachable.
 *
 * Errors are wrapped with a clear message that names the spec and
 * the install path; the raw `ERR_MODULE_NOT_FOUND` (or similar) is
 * preserved so the cause is still grep-able in logs.
 */
export async function resolveExtendsNpmPackage(
  spec: string,
  cwd: string,
  _isDetectRuleSpec: (value: unknown) => value is RuleSpec,
): Promise<readonly CompiledRule[]> {
  // Detect-rule extraction only — the bundle-path loader (loader.ts)
  // also calls `resolveExtendsBundle` for format / delegate specs.
  const bundle = await resolveExtendsBundle(spec, cwd);
  return bundle.rules;
}

/**
 * #34c — bundle resolution that returns the full
 * `ResolvedExtendsBundle`. Used by `loader.ts` to populate
 * `formatSpecs` and `delegateSpecs` from `extends: '@scope/...'`
 * entries alongside the existing detect-rule path.
 *
 * Same resolution + lookup contract as `resolveExtendsNpmPackage`;
 * split into a separate entry point so the loader can fetch all
 * three arrays in one dynamic import.
 *
 * `resolveFromFile` is an optional escape hatch used by the test
 * suite to point resolution at a sandbox directory. The argument
 * must be a FILE path inside the sandbox (e.g. a sentinel
 * `package.json`); `createRequire` doesn't accept bare directories.
 * The production path always uses `import.meta.url` so the
 * project's `node_modules` is reachable from the loader's
 * location. When `resolveFromFile` is omitted, resolution anchors
 * at this module's URL — exactly the behaviour callers see in
 * production.
 */
export async function resolveExtendsBundle(
  spec: string,
  cwd: string,
  resolveFromFile?: string,
): Promise<ResolvedExtendsBundle> {
  let mod: Record<string, unknown>;
  try {
    // `createRequire` requires a file URL (not a directory URL) to
    // anchor resolution against. Production passes `import.meta.url`
    // (a file). Tests pass a sentinel file path inside a sandbox
    // directory so resolution walks up from there. Passing a bare
    // directory fails with "Cannot find module".
    const baseUrl = resolveFromFile !== undefined
      ? pathToFileURL(resolveFromFile)
      : pathToFileURL(fileURLToPath(import.meta.url));
    const requireFromHere = createRequire(baseUrl);
    const resolvedAbs = requireFromHere.resolve(spec);
    mod = (await import(pathToFileURL(resolvedAbs).href)) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `regent: failed to load plugin '${spec}' — ${message}. `
      + `Verify the package is installed (npm/pnpm/bun install) and that it exposes `
      + `a rule / format-spec / delegate-spec shape (default, rule, or a named export).`,
    );
  }

  const sourceLabel = `extends '${spec}'`;
  const rules: CompiledRule[] = [];
  const formatSpecs: FormatRuleSpec<z.ZodTypeAny>[] = [];
  const delegateSpecs: DelegateRuleSpec<z.ZodTypeAny>[] = [];

  // Order: default → rule → rest of named exports. Mirrors
  // `importRuleFile` so locally-authored and plugin-published rules
  // are looked up the same way.
  const candidates: unknown[] = [];
  if (mod.default !== undefined && mod.default !== null) {
    candidates.push(mod.default);
  }
  if (mod.rule !== undefined && mod.rule !== null && mod.rule !== mod.default) {
    candidates.push(mod.rule);
  }
  for (const key of Object.keys(mod)) {
    if (key === 'default' || key === 'rule') {
      continue;
    }
    candidates.push(mod[key]);
  }

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    // Arrays are always a list of detect-rule shapes (the file-
    // discovery / inline `detect[]` convention). Bundles that need
    // to ship multiple format / delegate specs expose them as named
    // exports; mixing kinds in one array is rare and would
    // confuse the loader's narrow step.
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (isLoadableRuleSpec(item)) {
          rules.push({
            spec: item as RuleSpec,
            source: item.source ?? `${sourceLabel} (array)`,
            origin: { kind: 'repo', path: cwd },
          });
        }
      }
      continue;
    }
    // Single export — try the rule predicate first, then
    // format-spec, then delegate-spec. Order matters: a rule
    // shape that happens to have a `normalize` field would
    // otherwise match the format predicate; the rule predicate
    // checks `globs` which neither format nor delegate has.
    if (isLoadableRuleSpec(candidate)) {
      rules.push({
        spec: candidate as RuleSpec,
        source: candidate.source ?? sourceLabel,
        origin: { kind: 'repo', path: cwd },
      });
      continue;
    }
    // `__kind` marker (set by `defineFormat` / `defineDelegate`)
    // breaks the tie when both predicates match the same shape.
    // A delegate spec without `fix` is structurally identical to
    // a format spec without `fix`; the marker is the only way to
    // tell them apart at runtime.
    const marked = (candidate as { __kind?: string }).__kind;
    if (marked === 'format' && isFormatRuleSpecExport(candidate)) {
      formatSpecs.push({
        ...candidate,
        source: candidate.source ?? sourceLabel,
      });
      continue;
    }
    if (marked === 'delegate' && isDelegateRuleSpecExport(candidate)) {
      delegateSpecs.push({
        ...candidate,
        source: candidate.source ?? sourceLabel,
      });
      continue;
    }
    // Fallback when no marker (a bundle published without the
    // factory wrapper): try format first (broader shape — has
    // optional `fix` that delegate lacks), then delegate.
    if (isFormatRuleSpecExport(candidate)) {
      formatSpecs.push({
        ...candidate,
        source: candidate.source ?? sourceLabel,
      });
      continue;
    }
    if (isDelegateRuleSpecExport(candidate)) {
      delegateSpecs.push({
        ...candidate,
        source: candidate.source ?? sourceLabel,
      });
      continue;
    }
  }

  return { rules, formatSpecs, delegateSpecs };
}
