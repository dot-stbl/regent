// AST matcher — runs ast-grep (via @ast-grep/napi) against source text and
// returns precise matches. This is the `ast` rule kind's engine: unlike the
// regex path, it parses the code, so a rule can say "string argument to
// `.Property()`" and ignore `.HasColumnName("id")`.
//
// Language support comes from `@ast-grep/lang-<language>` packages — these
// ARE the "bundles" (grammar + version), registered lazily on first use.

import { parse, registerDynamicLanguage } from '@ast-grep/napi';

import { BUNDLES, resolveBundle } from '../bundles/index.js';

/**
 * An ast-grep rule config (NapiConfig shape): a `rule` (pattern / kind /
 * relational operators) plus optional `constraints`. Passed to ast-grep
 * verbatim, so the full rule language is available to authors.
 */
export interface AstGrepConfig {
  readonly rule: Readonly<Record<string, unknown>>;
  readonly constraints?: Readonly<Record<string, unknown>>;
  readonly utils?: Readonly<Record<string, unknown>>;
}

/** A single AST match — 0-based line/column span (start inclusive, end exclusive). */
export interface AstMatch {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly text: string;
}

let registeredAll = false;

/**
 * Register every bundle's grammar in ONE `registerDynamicLanguage` call,
 * lazily on first use. napi only honours a single dynamic-registration call
 * per process, so languages cannot be registered incrementally — we register
 * the whole set at once. A pack that fails to import is skipped (using such a
 * language later throws a clear error from `parseRoot`). Each pack is the
 * "bundle": it carries the tree-sitter grammar + its version.
 */
async function registerAll(): Promise<void> {
  if (registeredAll) {
    return;
  }
  const langs: Record<string, unknown> = {};
  for (const b of BUNDLES) {
    try {
      const mod = (await import(b.pack)) as { default?: unknown };
      langs[b.id] = mod.default ?? mod;
    } catch {
      // Pack not installed — skip; scanAst throws if that language is used.
    }
  }
  // Cast through `never` so the index-signature type-check passes without
  // importing napi's internal registration type.
  registerDynamicLanguage(langs as never);
  registeredAll = true;
}

function parseRoot(id: string, source: string) {
  try {
    return parse(id, source).root();
  } catch (err) {
    throw new Error(
      `regent: no language pack registered for '${id}' — add a bundle or an `
      + `@ast-grep/lang-${id} dependency. Cause: ${(err as Error).message}`,
    );
  }
}

/**
 * Scan `source` (a whole file) with an ast-grep rule for `language`.
 * Returns every match with a precise 0-based span.
 */
export async function scanAst(
  language: string,
  source: string,
  config: AstGrepConfig,
): Promise<AstMatch[]> {
  // Resolve aliases (e.g. `cs` → `csharp`) and the grammar pack via the
  // bundle registry; fall back to the `@ast-grep/lang-<id>` convention for
  // languages not in the registry.
  const bundle = resolveBundle(language);
  const id = bundle?.id ?? language.toLowerCase();
  await registerAll();
  const root = parseRoot(id, source);
  const hits = root.findAll(config as never);
  return hits.map((node) => {
    const r = node.range();
    return {
      startLine: r.start.line,
      startColumn: r.start.column,
      endLine: r.end.line,
      endColumn: r.end.column,
      text: node.text(),
    };
  });
}
