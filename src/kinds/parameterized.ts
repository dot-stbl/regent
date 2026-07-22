// `defineParameterizedRule` — type-safe parameterized rule.
//
// Author declares a `params: zod schema`. Fields that need the
// parameters (`pattern`, optionally `excludeWhen` and `message`)
// become `string | (params) => string`. The loader materializes
// them by validating the per-rule `configure` value against the
// schema and applying defaults (see #33b — `materializeParameterized`
// in `src/loader/parameterize.ts`).
//
// Backward-compat: rules without `params` stay on `defineDetectRule`.
// `defineParameterizedRule` is the new entry point; the two helpers
// are siblings, not a hierarchy.

import type { z } from 'zod';

import type {
  RuleFixSpec,
  RuleReviewSpec,
  Severity,
} from '../types.js';

/**
 * A rule that declares its own typed parameters via a zod schema.
 *
 * Use this surface when the rule's `pattern`, `excludeWhen`, or
 * `message` depend on values that should live in the config rather
 * than be hardcoded into the rule. The `params` schema is the single
 * source of truth for what is valid; `rules.configure[<ruleId>]`
 * supplies the configured values at load time.
 */
export interface ParameterizedRuleSpec<TParams extends z.ZodTypeAny> {
  /** Stable identifier (e.g. `csharp.max-line-length`). */
  readonly id: string;

  /** Severity for findings. Drives exit code + reporter color. */
  readonly severity: Severity;

  /**
   * Author-owned zod schema. Defaults are applied via `.default()`
   * on individual fields — the loader picks those up via the schema's
   * own `.default()` machinery, not from a separate defaults block.
   */
  readonly params: TParams;

  /**
   * Pattern may be a plain string (no parameterisation) or a function
   * over the inferred params (`z.infer<TParams>`). The function is
   * called exactly once at materialisation time, with the merged
   * (defaults applied) params.
   */
  readonly pattern: string | ((p: z.infer<TParams>) => string);

  /**
   * Optional RE2 pattern; if a line matches BOTH `pattern` and
   * `excludeWhen`, the finding is suppressed. Same function/string
   * shape as `pattern`.
   */
  readonly excludeWhen?: string | ((p: z.infer<TParams>) => string);

  /** Glob patterns of files to scan. */
  readonly globs: readonly string[];

  /**
   * Glob patterns of files to exclude (matched against the absolute path).
   */
  readonly excludePaths?: readonly string[];

  /** Short human message shown in the text reporter. */
  readonly message: string | ((p: z.infer<TParams>) => string);

  /** Back-link to the `.md` prose (SARIF `helpUri`). Auto-derived when omitted. */
  readonly source?: string;

  /** Optional longer explanation shown above the context snippet. */
  readonly rationale?: string;

  /** Review-mode configuration. Tri-state handling when `enabled`. */
  readonly review?: RuleReviewSpec;

  /** Optional auto-fix attachment. See {@link RuleFixSpec}. */
  readonly fix?: RuleFixSpec;

  /** Other rule ids whose findings must be present for this rule to fire. */
  readonly dependsOn?: readonly string[];
}

/**
 * Type-safe factory for {@link ParameterizedRuleSpec}. Mirrors
 * `defineDetectRule`: validates the spec at compile-time via the
 * `const T extends ParameterizedRuleSpec<TParams>` constraint and
 * freezes the object so accidental mutation after definition fails
 * loudly.
 *
 * `TParams` is captured as a `const` so `z.infer<TParams>` narrows
 * to the concrete schema's inferred shape — there is no runtime
 * cast involved.
 */
export function defineParameterizedRule<
  const TParams extends z.ZodTypeAny,
  const T extends ParameterizedRuleSpec<TParams>,
>(rule: T): T {
  return Object.freeze(rule) as T;
}
