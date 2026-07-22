// `defineDelegate` — type-safe spec for read-only analysis tools
// (`eslint`, `ruff check`, `golangci-lint run`, `tsc --noEmit`,
// `cargo check`, security scanners, etc.).
//
// The contract:
//   - `detect: (p) => string[]` — read-only argv. `regent check`
//     and `regent fix` both run this. There is no mutating form
//     (delegated tools are observational, not transforming) — if
//     you need to apply a fix, use `defineFormat` instead.
//   - `normalize` — maps the captured `ToolProcessResult` (exit
//     code + stdout + stderr + argv) to `Finding[]`. Bundles ship
//     built-in normalizers for the common tools; custom specs
//     write their own.
//
// The runner enforces the same token blocklist as
// `defineFormat` (`--watch` / `--serve` / port-binding flags are
// rejected before spawn) — see `safeInvokeDelegate` in 34b.

import type { z } from 'zod';

import type {
  RuleReviewSpec,
  Severity,
} from '../types.js';
import type { Normalize } from './process.js';

/**
 * A `defineDelegate` spec — read-only analysis tools that the
 * runner shells out to. Use this for tools that report
 * violations but do not transform files; use `defineFormat` for
 * tools that do.
 */
export interface DelegateRuleSpec<TParams extends z.ZodTypeAny> {
  /** Stable identifier (e.g. `eslint.security`). */
  readonly id: string;

  /** Severity for the findings this spec produces. */
  readonly severity: Severity;

  /**
   * Author-owned zod schema. Same defaults + validation contract
   * as `ParameterizedRuleSpec.params` — see #33 and
   * `src/loader/parameterize.ts` for the materialisation flow.
   */
  readonly params: TParams;

  /**
   * Read-only detect argv. `regent check` and `regent fix` both
   * run this; the tool MUST NOT mutate files (the runner refuses
   * `watch` / `serve` / port-binding flags; see 34b's
   * `safeInvokeDelegate`).
   */
  readonly detect: (p: z.infer<TParams>) => readonly string[];

  /**
   * Parse the captured `ToolProcessResult` (exit code + stdout
   * + stderr) into regent `Finding[]`. Bundles typically ship a
   * built-in normalizer; custom specs in `tools/audit/` provide
   * their own.
   */
  readonly normalize: Normalize;

  /** Back-link to the prose document. SARIF `helpUri`. */
  readonly source?: string;

  /** Longer explanation shown above the context snippet. */
  readonly rationale?: string;

  /** Review-mode configuration. Tri-state handling when `enabled`. */
  readonly review?: RuleReviewSpec;

  /** Other rule ids whose findings must be present for this rule to fire. */
  readonly dependsOn?: readonly string[];

  /**
   * When `true`, the runner's fixpoint loop (`applyFixes`) may
   * re-run this spec's `detect` after a sibling format-spec
   * applies edits. Read-only tools (eslint, ruff) set this
   * `true` so the user sees new findings the format step exposed.
   * Heavy tools (cargo check on a monorepo) set this `false` to
   * bound the iteration cost. Default: `true`.
   */
  readonly converges?: boolean;
}

/**
 * Type-safe factory for {@link DelegateRuleSpec}. Mirrors
 * `defineParameterizedRule` and `defineFormat`.
 */
export function defineDelegate<
  const TParams extends z.ZodTypeAny,
  const T extends DelegateRuleSpec<TParams>,
>(spec: T): T {
  return Object.freeze(spec) as T;
}
