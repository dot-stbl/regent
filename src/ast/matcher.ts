// AST matcher — runs ast-grep (via @ast-grep/napi) against source text and
// returns precise matches. This is the `ast` rule kind's engine: unlike the
// regex path, it parses the code, so a rule can say "string argument to
// `.Property()`" and ignore `.HasColumnName("id")`.
//
// Language support comes from `@ast-grep/lang-<language>` packages — these
// ARE the "bundles" (grammar + version), registered lazily on first use.

import { parse, registerDynamicLanguage } from '@ast-grep/napi';

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

const registered = new Set<string>();

/**
 * Register the ast-grep language pack (`@ast-grep/lang-<language>`) on first
 * use. The pack is the "bundle" — it carries the tree-sitter grammar and its
 * version, so pinning the pack pins the grammar. Throws a clear, actionable
 * error when the pack isn't installed.
 */
async function ensureLanguage(language: string): Promise<void> {
  if (registered.has(language)) {
    return;
  }
  let mod: { default?: unknown };
  try {
    mod = (await import(`@ast-grep/lang-${language}`)) as { default?: unknown };
  } catch (err) {
    throw new Error(
      `regent: AST language pack '@ast-grep/lang-${language}' is not installed `
      + `(required for language '${language}'). Add it as a dependency. `
      + `Cause: ${(err as Error).message}`,
    );
  }
  // The pack's default export is a napi LangRegistration; cast through
  // `never` so the index-signature type-check passes without importing
  // napi's internal registration type.
  registerDynamicLanguage({ [language]: (mod.default ?? mod) as never });
  registered.add(language);
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
  await ensureLanguage(language);
  const root = parse(language, source).root();
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
