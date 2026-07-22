// Parameterization step (#33b) — resolves per-rule `configure`
// values against the rule's `zod` `params` schema and rewrites the
// function-typed fields (`pattern`, `excludeWhen`, `message`) into
// plain strings. After materialisation, the resulting `RuleSpec`
// flows unchanged through the rest of the pipeline — the runner,
// reporters, and the fix engine are unaware that the rule was
// parameterised at authoring time.
//
// Failure modes (all thrown as `ParameterizeError` with a rule id
// + a `ZodError`-flavoured message):
//   - `rules.configure[<id>]` references a rule id that does not
//     exist in the merged set. Caught before any materialisation
//     so the error names the bad key, not the first rule.
//   - `rules.configure[<id>]` value fails the rule's own `params`
//     schema. Includes the zod path + message so the user can fix
//     the value without guessing.
//   - Function-typed fields are evaluated exactly once at materialisation;
//     they MUST be pure + deterministic (same as `transform` rules).

import { z, type ZodError } from 'zod';

import type { ParameterizedRuleSpec } from '../kinds/parameterized.js';
import type { CompiledRule, RuleSpec } from '../types.js';

export class ParameterizeError extends Error {
  public readonly ruleId: string;

  override readonly name: string = 'ParameterizeError';
  override readonly cause: string;

  constructor(ruleId: string, cause: string) {
    super(`regent: parameterize error for rule '${ruleId}' — ${cause}`);
    this.ruleId = ruleId;
    this.cause = cause;
  }
}

/**
 * Resolve the per-rule `configure` value against the rule's
 * `params` zod schema and return a `RuleSpec`-shape object with
 * concrete string fields. Defaults applied by the schema's own
 * `.default()` machinery; caller passes `{}` to use defaults
 * exclusively. Throws `ParameterizeError` on validation failure.
 */
export function materializeParameterized(
  spec: ParameterizedRuleSpec<z.ZodTypeAny>,
  configuredValues: unknown,
): RuleSpec {
  let parsed: unknown;
  try {
    // Zod 4 — `.parse` throws on failure. We catch and rewrap into
    // a `ParameterizeError` so the loader's failure surface is
    // shaped the same as the rest of the regent errors. The
    // `parameter validation failed:` prefix is constant so an LLM
    // agent / a CI grep can branch on the failure shape.
    parsed = spec.params.parse(configuredValues ?? {});
  } catch (err) {
    const detail = err instanceof z.ZodError
      ? formatParamZodError(err)
      : err instanceof Error
        ? err.message
        : String(err);
    throw new ParameterizeError(
      spec.id,
      `parameter validation failed:\n${detail}`,
    );
  }

  const pattern = typeof spec.pattern === 'function'
    ? (spec.pattern as (p: unknown) => string)(parsed)
    : spec.pattern;
  const excludeWhen = resolveOptional(spec.excludeWhen, parsed);
  const message = typeof spec.message === 'function'
    ? (spec.message as (p: unknown) => string)(parsed)
    : spec.message;

  const result: {
    id: string;
    severity: RuleSpec['severity'];
    pattern: string;
    message: string;
    globs: readonly string[];
    excludeWhen?: string;
    excludePaths?: readonly string[];
    source?: string;
    rationale?: string;
    review?: RuleSpec['review'];
    fix?: RuleSpec['fix'];
    dependsOn?: readonly string[];
  } = {
    id: spec.id,
    severity: spec.severity,
    pattern,
    message,
    globs: spec.globs,
  };
  if (excludeWhen !== undefined) result.excludeWhen = excludeWhen;
  if (spec.excludePaths !== undefined) result.excludePaths = spec.excludePaths;
  if (spec.source !== undefined) result.source = spec.source;
  if (spec.rationale !== undefined) result.rationale = spec.rationale;
  if (spec.review !== undefined) result.review = spec.review;
  if (spec.fix !== undefined) result.fix = spec.fix;
  if (spec.dependsOn !== undefined) result.dependsOn = spec.dependsOn;

  return result as RuleSpec;
}

function resolveOptional(
  field: string | ((p: unknown) => string) | undefined,
  params: unknown,
): string | undefined {
  if (field === undefined) return undefined;
  return typeof field === 'function'
    ? (field as (p: unknown) => string)(params)
    : field;
}

/**
 * Per-rule parameterisation snapshot — what `describe` (`#33c`)
 * introspects. Captured during step 4b so `regent describe` can
 * emit the JSON Schema of the rule's `params` and a sample
 * `rules.configure` block *after* the loader has already dropped
 * the live `params` schema from the materialised `RuleSpec`.
 *
 * The loader emits one entry per rule that *had* `params` (whether
 * or not the rule was successfully materialised); if materialisation
 * throws, the snapshot for that rule is omitted and the error
 * surfaces separately via `loadRules()`'s rejection.
 */
export interface ParameterisedRuleSnapshot {
  readonly id: string;
  readonly source: string;
  readonly origin: string | undefined;
  readonly severity: RuleSpec['severity'];
  readonly globs: readonly string[];
  readonly rationale: string | undefined;
  readonly params: z.ZodTypeAny;
}

/**
 * Validate that every key in `configure` maps to a rule id in the
 * merged set. Throws `ParameterizeError` naming the first unknown
 * id (deterministic order — keys are sorted). Empty `configure`
 * is a no-op.
 *
 * Validation runs BEFORE per-rule materialisation so the error
 * names the bad key without misleading the user about which rule
 * failed first.
 */
export function validateConfigureKeys(
  ruleIds: readonly string[],
  configure: Readonly<Record<string, unknown>>,
): void {
  const ids = new Set(ruleIds);
  const unknownKeys = Object.keys(configure)
    .filter((k) => !ids.has(k))
    .sort();
  for (const key of unknownKeys) {
    throw new ParameterizeError(
      key,
      `rules.configure['${key}'] has no matching rule — the rule id is unknown. ` +
      `Either drop the entry, fix the typo, or add a rule with this id.`,
    );
  }
}

/**
 * Map a `CompiledRule` through the materialiser when its spec is
 * a `ParameterizedRuleSpec` (detected via the `params` field).
 * Non-parameterised rules pass through unchanged — the loader
 * otherwise treats detect / fix / ast / transform identically.
 *
 * The companion snapshot (`ParameterisedRuleSnapshot`) is built
 * before materialisation so consumers like `regent describe` can
 * introspect the rule's live `params` schema after the loader
 * drops it from the `RuleSpec`. Returning `null` from this helper
 * signals "non-parameterised"; returning a snapshot signals
 * "parameterised; here's its pre-materialisation shape".
 */
export function snapshotParameterisedRule(
  rule: CompiledRule,
): ParameterisedRuleSnapshot | null {
  const raw = rule.spec as unknown as { readonly params?: z.ZodTypeAny };
  if (raw.params === undefined || raw.params === null) {
    return null;
  }
  const spec = rule.spec as unknown as ParameterizedRuleSpec<z.ZodTypeAny>;
  return {
    id: spec.id,
    source: rule.source,
    origin: spec.source,
    severity: spec.severity,
    globs: spec.globs,
    rationale: spec.rationale,
    params: spec.params,
  };
}

export function materializeRule(
  rule: CompiledRule,
  configure: Readonly<Record<string, unknown>>,
): CompiledRule {
  // Runtime detection — `params` is the discriminator (the field
  // only exists on `ParameterizedRuleSpec`). The `unknown` cast
  // bridges the CompiledRule.spec: RuleSpec typing: at this point
  // parameterised specs ride along as `RuleSpec`-typed objects,
  // and we narrow via the `params` field check.
  const raw = rule.spec as unknown as { params?: unknown };
  if (raw.params === undefined || raw.params === null) {
    return rule;
  }
  const spec = rule.spec as unknown as ParameterizedRuleSpec<z.ZodTypeAny>;
  const configured = configure[spec.id] ?? {};
  const materializedSpec = materializeParameterized(spec, configured);
  return { ...rule, spec: materializedSpec };
}

/**
 * Format a `ZodError` from params validation. Reused shape across
 * all zod-instrumented validation paths in regent so error styling
 * stays consistent for an LLM agent reading the message.
 */
function formatParamZodError(err: ZodError): string {
  const lines: string[] = [];
  for (const issue of err.issues) {
    const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
    lines.push(`  ${path}: ${issue.message}`);
  }
  return `parameter validation failed:\n${lines.join('\n')}`;
}
