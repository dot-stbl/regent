// Plugin resolution for `extends: '@scope/name'` (#23).
//
// Splits the npm-shaped extends branch out of `loader.ts` so the main
// file stays in the ~600-line range that the codebase already had.
// Pure logic: a regex check + a dynamic-import wrapper. No state.

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { CompiledRule, RuleSpec } from '../types.js';

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
 * Resolve `extends: '@scope/name'` by dynamic-importing the npm
 * package. The package must export a rule shape — a `default`
 * export (single spec or array), a `rule` export, or any named
 * export whose value matches the `RuleSpec` discriminator. Mirrors
 * the lookup order used for local rule files so the two paths stay
 * symmetric.
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
  isDetectRuleSpec: (value: unknown) => value is RuleSpec,
): Promise<CompiledRule[]> {
  let mod: Record<string, unknown>;
  try {
    const here = pathToFileURL(fileURLToPath(import.meta.url));
    const requireFromHere = createRequire(here);
    const resolvedAbs = requireFromHere.resolve(spec);
    mod = (await import(pathToFileURL(resolvedAbs).href)) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `regent: failed to load plugin '${spec}' — ${message}. `
      + `Verify the package is installed (npm/pnpm/bun install) and that it exposes `
      + `a rule-shape export (default, rule, or a named export with id + severity + pattern + globs + message).`,
    );
  }

  const sourceLabel = `extends '${spec}'`;
  const out: CompiledRule[] = [];

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
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (isDetectRuleSpec(item)) {
          out.push({
            spec: item,
            source: item.source ?? `${sourceLabel} (array)`,
            origin: { kind: 'repo', path: cwd },
          });
        }
      }
      continue;
    }
    if (isDetectRuleSpec(candidate)) {
      out.push({
        spec: candidate,
        source: candidate.source ?? sourceLabel,
        origin: { kind: 'repo', path: cwd },
      });
    }
  }
  return out;
}
