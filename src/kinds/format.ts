// `defineFormat` — type-safe spec for file-mutating tools
// (`dotnet format`, `prettier --write`, `eslint --fix`,
// `gofmt -w`, `ruff format`, etc.).
//
// The contract:
//   - `detect: (p) => string[]` — dry-run argv. `regent check` runs
//     this and reports `Finding`s from `normalize`.
//   - `fix:    (p) => string[]` — mutating argv. `regent fix` runs
//     this in addition to `detect`. If the tool's mutating form is
//     identical to its detect form (e.g. tools whose only mode is
//     read-only reporting), `fix` MAY be omitted; the runner
//     treats such specs as detect-only.
//   - `normalize` — maps the captured `ToolProcessResult` (exit
//     code + stdout + stderr + argv) to `Finding[]` for regent's
//     report. Bundles ship a built-in normalizer; custom specs
//     write their own.
//
// The runner enforces a token blocklist (`--watch` / `--port` /
// etc.) before spawn — see `safeInvokeDelegate` in 34b.

import type { z } from 'zod';

import type {
  RuleReviewSpec,
  Severity,
} from '../types.js';
import type { Normalize } from './process.js';

/**
 * A `defineFormat` spec — file-mutating tools that the runner
 * shells out to. The shape is intentionally close to
 * `ParameterizedRuleSpec` (#33) so spec authors carry the same
 * muscle memory: `params` is a zod schema with `.default()`s,
 * `detect` / `fix` are typed functions over `z.infer<TParams>`.
 */
export interface FormatRuleSpec<TParams extends z.ZodTypeAny> {
  /** Stable identifier (e.g. `dotnet.whitespace`). */
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
   * Dry-run argv. Called once per `regent check` per file scope
   * (or per `regent fix`, where it runs first to surface a
   * pre-edit diff). Pure function: no side effects, no I/O.
   */
  readonly detect: (p: z.infer<TParams>) => readonly string[];

  /**
   * Mutating argv. Called by `regent fix`. May be omitted for
   * tools that only ever report (the runner treats such specs as
   * detect-only and `regent fix` falls back to running `detect`
   * for reporting purposes).
   */
  readonly fix?: (p: z.infer<TParams>) => readonly string[];

  /**
   * Parse the captured `ToolProcessResult` (exit code + stdout
   * + stderr) into regent `Finding[]`. Bundles typically ship a
   * built-in normalizer for the common tools (e.g. `dotnet format`
   * `prettier --check`); custom specs in `tools/audit/` write
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
   * When `true`, the runner's fixpoint loop (`applyFixes`) is allowed
   * to re-run this spec's `detect` after a fix-application pass and
   * expect the same shape. Most formatters are idempotent
   * (prettier, dotnet format, gofmt); some ordering-sensitive
   * tools (imports sorters, key-sorters) re-shape the file on
   * each pass and should set this to `false`. Default: `true` when
   * `fix` is present, `false` otherwise.
   */
  readonly converges?: boolean;
}

/**
 * Type-safe factory for {@link FormatRuleSpec}. Mirrors
 * `defineParameterizedRule`: validates the spec at compile-time via
 * the `const T extends FormatRuleSpec<TParams>` constraint and
 * freezes the object so accidental mutation after definition fails
 * loudly. Also attaches a private `__kind` marker so the loader
 * can distinguish format specs from delegate specs at runtime
 * when both predicates match the same shape (a delegate spec is
 * a format spec with `fix` absent — both expose `detect` +
 * `normalize`; the marker breaks the tie).
 */
export function defineFormat<
  const TParams extends z.ZodTypeAny,
  const T extends FormatRuleSpec<TParams>,
>(spec: T): T {
  return Object.freeze({
    __kind: 'format',
    ...spec,
  }) as T;
}
