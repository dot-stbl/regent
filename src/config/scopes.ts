// Scope resolution for monorepo support (issue #35).
//
// A scope bundles `(root, rules, params, excludes)` for a single
// subproject inside a monorepo. The root config declares named scopes
// via `scopes: { [name]: { root } }`; the CLI selects them via `-s
// <name>` (comma-separated for multiple).
//
// This module owns the *resolution* — given a comma-separated CLI
// flag and the merged root config, return the list of scopes to run,
// in the order the user asked for. The actual per-scope config
// layering (loading `.regentrc.*` from the scope's root) is in
// `src/config/scope-loader.ts`; this module just turns names into
// `{ name, root }` records and surfaces clear errors for typos.

import { isAbsolute, resolve } from 'node:path';

import type { RegentConfig } from './schema.js';

/**
 * One resolved scope — the name the user asked for plus the absolute
 * root directory the runner should scan. The name flows through to
 * `Finding.scope` so the reporter can tag every output line.
 */
export interface ResolvedScope {
  /** Scope name as declared in the root config. */
  readonly name: string;
  /** Absolute path to the scope's root (resolved against the repo cwd). */
  readonly root: string;
  /** Repo-relative path (original, for display in `regent scopes`). */
  readonly relativeRoot: string;
}

/**
 * Parse `-s a,b,c` into a de-duplicated list of scope names. Trims
 * whitespace around each name; throws on empty entries so the CLI
 * surfaces a clear "use one of: …" message instead of silently
 * running zero scopes.
 *
 * Empty / undefined input returns an empty list — caller decides what
 * "no -s" means (run every scope, or run the implicit `default`).
 */
export function parseScopeNames(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') {
      throw new Error(
        `invalid -s value '${raw}': empty scope name (comma with nothing after it). Expected 'frontend,backend'.`,
      );
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Look up scope specs by name in a merged config and resolve their
 * `root` against `cwd`. Throws if a name doesn't match a declared
 * scope (typo guard) — silent fallback would mask `regent check -s
 * frontent` from the user.
 *
 * Names that ARE declared are returned in the order the user asked
 * for (not the order they appear in the config) — important for
 * multi-scope runs where the user expects the output to mirror the
 * CLI invocation order.
 */
export function resolveScopes(
  config: RegentConfig,
  names: readonly string[],
  cwd: string,
): ResolvedScope[] {
  if (names.length === 0) {
    return [];
  }
  const out: ResolvedScope[] = [];
  for (const name of names) {
    const spec = config.scopes[name];
    if (spec === undefined) {
      const known = Object.keys(config.scopes).sort();
      const hint = known.length === 0
        ? 'no scopes are declared in the root config (set `scopes: { ... }` in .regentrc.ts, or omit -s for the implicit default scope).'
        : `known scopes: ${known.join(', ')}`;
      throw new Error(`unknown scope '${name}' — ${hint}`);
    }
    const root = isAbsolute(spec.root)
      ? spec.root
      : resolve(cwd, spec.root);
    out.push({ name, root, relativeRoot: spec.root });
  }
  return out;
}

/**
 * When the user runs `regent check` with no `-s` flag, the behavior
 * depends on the config:
 *
 *   - `scopes: { a, b }` declared → run every scope in declaration order
 *     (config-key order is insertion-order on a plain object — stable
 *     across Node ≥ 7).
 *   - no `scopes` block → one implicit `default` scope rooted at cwd,
 *     so the single-project case keeps working exactly as in v0.3.
 *
 * Returns the list of scopes to run. Each entry has the same shape
 * as `resolveScopes()` so the caller doesn't need a branch.
 */
export function defaultScopes(
  config: RegentConfig,
  cwd: string,
): ResolvedScope[] {
  const names = Object.keys(config.scopes);
  if (names.length === 0) {
    return [
      {
        name: 'default',
        root: cwd,
        relativeRoot: '.',
      },
    ];
  }
  return resolveScopes(config, names, cwd);
}