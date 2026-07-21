// `defineAstRule` — an AST-based rule (ast-grep matcher). This is the primary
// rule kind going forward; the regex kind (`defineDetectRule`) is retained but
// deprecated, because regex over text can't tell `.Property("Id")` (a magic
// string) from `.HasColumnName("id")` (required) — AST can.

import type { AstGrepConfig } from '../ast/matcher.js';
import type { Severity } from '../types.js';

export interface AstRuleSpec {
  /** Stable id, e.g. `csharp.ef.magic-property`. */
  readonly id: string;
  /** ast-grep language pack name (the "bundle"), e.g. `csharp`. */
  readonly language: string;
  readonly severity: Severity;
  readonly message: string;
  /** Glob patterns of files to scan. */
  readonly globs: readonly string[];
  readonly excludePaths?: readonly string[];
  /** Back-link to the `.md` prose (SARIF `helpUri`). Auto-derived when omitted. */
  readonly source?: string;
  readonly rationale?: string;
  /** The ast-grep matcher (pattern + optional constraints), passed through. */
  readonly ast: AstGrepConfig;
}

export function defineAstRule<const T extends AstRuleSpec>(rule: T): T {
  return Object.freeze(rule) as T;
}
