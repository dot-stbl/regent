// Zod schema for `regent` configuration.
//
// v0.2 configuration shape:
//
//   - `rules.detect[]`   — detect-only rules (pattern → finding)
//   - `rules.fix[]`      — match → replace rules
//   - `excludePaths`     — project-wide exclude globs (or `@group` refs)
//   - `excludeGroups`    — user-defined named exclude groups
//   - `cache.enabled`    — toggle disk cache (`.regent/cache.json`)
//   - `cache.maxBytes`   — LRU cap
//   - `cache.maxAge`     — TTL in ms; stale entries dropped on load
//   - `log.level`        — pino level
//   - `log.format`       — `text` (TTY) or `json` (CI)
//   - `output.color`     — ANSI colour for findings
//   - `output.contextBuffer` — lines before/after each match
//   - `runner.concurrency` — max in-flight per-file scans (default 4)
//
// Strict mode: unknown keys → ZodError at load time. Fail-fast.
//
// Source precedence (low → high): defaults < global < project < local
// < env < args. Merged via `src/config/merge.ts`.

import { z } from 'zod';

import { GROUP_PREFIX } from './groups.js';

const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const LogFormatSchema = z.enum(['text', 'json']);
const SeveritySchema = z.enum(['error', 'warning', 'suggestion']);

/**
 * Validate a `globs` / `excludePaths` array: each entry must be a
 * non-empty string. Group references are accepted (and resolved later).
 */
const GlobStringSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    if (value.startsWith(GROUP_PREFIX)) {
      const name = value.slice(GROUP_PREFIX.length);
      if (name.length === 0 || name.includes('/') || name.includes('\\')) {
        ctx.addIssue({
          code: 'custom',
          message: `invalid group reference '${value}' — group names must be non-empty and contain no path separators`,
        });
      }
    }
  });

const GlobListSchema = z.array(GlobStringSchema).readonly();

const RuleReviewSpecSchema = z
  .object({
    enabled: z.boolean(),
    guidance: z.string().optional(),
    exitBehavior: z.enum(['no-fail', 'unreviewed-fails']).optional(),
  })
  .strict();

const FixSafetySchema = z.union([z.literal('safe'), z.literal('suggested')]);

const RuleFixReplaceSchema = z
  .object({
    kind: z.literal('replace'),
    safety: FixSafetySchema,
    title: z.string().min(1),
    guidance: z.string().optional(),
    template: z.string(),
    targetGroup: z.union([z.number(), z.string()]).optional(),
    // Phase 4 fixpoint opt-in: when true, the rule participates in
    // applyFixes' per-file re-scan after edits are applied. Default
    // false — most rules are single-pass. See RuleFixBase.converges
    // in src/types.ts.
    converges: z.boolean().optional(),
  })
  .strict();

const RuleFixDeleteLineSchema = z
  .object({
    kind: z.literal('delete-line'),
    safety: FixSafetySchema,
    title: z.string().min(1),
    guidance: z.string().optional(),
    alsoDeleteMatching: z.string().optional(),
    converges: z.boolean().optional(),
  })
  .strict();

/**
 * The function-form is accepted by Zod (the `apply` function passes
 * schema validation), but inline `rules.detect[]` entries without a
 * real function are dropped at load time (see loader `transformInlineFix`).
 * The runtime contract is enforced by the fixer engine (P2) when it
 * invokes `apply` — `null` declines, any side effects or non-purity
 * would defeat the content-hash cache.
 */
const RuleFixFunctionSchema = z
  .object({
    kind: z.literal('function'),
    safety: FixSafetySchema,
    title: z.string().min(1),
    guidance: z.string().optional(),
    // `apply` is a runtime function; Zod can't type-validate it.
    // The loader runtime-checks that the field is a function before
    // accepting the rule (see loader `validateFixRuntime`).
    apply: z.unknown(),
    converges: z.boolean().optional(),
  })
  .strict();

const RuleFixGuidanceOnlySchema = z
  .object({
    kind: z.literal('guidance-only'),
    safety: FixSafetySchema,
    title: z.string().min(1),
    guidance: z.string().optional(),
    converges: z.boolean().optional(),
  })
  .strict();

/**
 * Discriminated union for the optional `fix` field on a rule spec
 * (P1 of the fix-mode epic). The safety↔kind invariants are
 * enforced by the loader via `validateFixSpec`.
 */
const RuleFixSpecSchema = z.discriminatedUnion('kind', [
  RuleFixReplaceSchema,
  RuleFixDeleteLineSchema,
  RuleFixFunctionSchema,
  RuleFixGuidanceOnlySchema,
]);

/**
 * Inline detection-rule shape (also the shape emitted by `defineDetectRule`'s
 * author-side helper). Accepts parameterised variants (`params`, function-
 * typed `pattern` / `message` / `excludeWhen`) because inline `detect[]`
 * entries in a `.regentrc.ts` are authored in TypeScript with the full
 * parameterisation surface — the loader materialises function-typed
 * fields against `configure[<ruleId>]` at step 4b, so the runner never
 * sees them. `.passthrough()` keeps the schema forward-compatible with
 * new optional fields without a breaking change.
 */
const DetectRuleSpecSchema = z
  .object({
    id: z.string().min(1),
    severity: SeveritySchema,
    pattern: z.union([z.string().min(1), z.function()]),
    excludeWhen: z.union([z.string(), z.function()]).optional(),
    globs: GlobListSchema,
    excludePaths: GlobListSchema.optional(),
    message: z.union([z.string().min(1), z.function()]),
    source: z.string().optional(),
    rationale: z.string().optional(),
    review: RuleReviewSpecSchema.optional(),
    fix: RuleFixSpecSchema.optional(),
    dependsOn: z.array(z.string().min(1)).readonly().optional(),
    params: z.unknown().optional(),
  })
  .passthrough();

/**
 * Inline `defineFormat` spec for `.regentrc.ts` `rules.format[]`
 * entries (#34). Mirrors the function-typed surface of
 * `DetectRuleSpecSchema` (parametrised field per #33c) so the
 * schema accepts both static `string[]` and function-form argv
 * builders. `.passthrough()` keeps the schema forward-compatible
 * with future optional fields. Discovery + bundle plumbing land in
 * 34c.
 */
const FormatRuleSpecSchema = z
  .object({
    id: z.string().min(1),
    severity: SeveritySchema,
    params: z.unknown().optional(),
    detect: z.union([z.function(), z.array(z.string())]),
    fix: z.union([z.function(), z.array(z.string())]).optional(),
    // `normalize` is a runtime function (ToolProcessResult → Finding[]);
    // zod can't type-validate it. The loader runtime-checks that
    // the field is a function before accepting the spec (see 34b's
    // `safeInvokeDelegate` wrapper).
    normalize: z.unknown(),
    source: z.string().optional(),
    rationale: z.string().optional(),
    review: RuleReviewSpecSchema.optional(),
    dependsOn: z.array(z.string().min(1)).readonly().optional(),
    converges: z.boolean().optional(),
  })
  .passthrough();

/**
 * Inline `defineDelegate` spec for `.regentrc.ts`
 * `rules.delegate[]` entries (#34). Read-only counterpart to
 * `FormatRuleSpecSchema`: no `fix` (delegates are observational).
 */
const DelegateRuleSpecSchema = z
  .object({
    id: z.string().min(1),
    severity: SeveritySchema,
    params: z.unknown().optional(),
    detect: z.union([z.function(), z.array(z.string())]),
    // `normalize` is a runtime function (see 34b).
    normalize: z.unknown(),
    source: z.string().optional(),
    rationale: z.string().optional(),
    review: RuleReviewSpecSchema.optional(),
    dependsOn: z.array(z.string().min(1)).readonly().optional(),
    converges: z.boolean().optional(),
  })
  .passthrough();

const FixRuleSpecSchema = z
  .object({
    id: z.string().min(1),
    severity: SeveritySchema,
    find: z.string().min(1),
    // replace MAY be empty (means "delete the match"). Common case
    // (whitespace strip, quote removal) usually has a non-empty
    // replacement; we don't enforce it.
    replace: z.string(),
    all: z.boolean().optional(),
    globs: GlobListSchema,
    excludePaths: GlobListSchema.optional(),
    message: z.string().min(1),
    dependsOn: z.array(z.string().min(1)).readonly().optional(),
  })
  .strict();

const AstRuleSpecSchema = z
  .object({
    id: z.string().min(1),
    language: z.string().min(1),
    severity: SeveritySchema,
    globs: GlobListSchema,
    excludePaths: GlobListSchema.optional(),
    message: z.string().min(1),
    source: z.string().optional(),
    rationale: z.string().optional(),
    // ast-grep matcher config (rule + optional constraints). Validated
    // loosely here — ast-grep validates the rule internals at scan time.
    ast: z.object({ rule: z.record(z.string(), z.unknown()) }).passthrough(),
  })
  .strict();

/**
 * `TransformRuleSpec` — programmatic whole-file rewrite.
 *
 * The `transform` function takes the file path and the current content,
 * returns the new content. It MUST be pure + deterministic (returning
 * `null` declines the rewrite); non-pure transforms would defeat the
 * content-hash cache and make `--check` non-idempotent.
 *
 * Wiring into the runner pipeline (detect → fix → transform) lands in
 * the v0.3 follow-up #25. Until then, transform rules are loaded and
 * validated, but never invoked.
 */
const TransformRuleSpecSchema = z
  .object({
    id: z.string().min(1),
    severity: SeveritySchema,
    globs: GlobListSchema,
    excludePaths: GlobListSchema.optional(),
    message: z.string().min(1),
    source: z.string().optional(),
    rationale: z.string().optional(),
    dependsOn: z.array(z.string().min(1)).readonly().optional(),
  })
  .strict();

/**
 * Named exclude-group dictionary. Keys are bare names (no `@` prefix).
 * Values are glob arrays. Validated against duplicate / reserved names.
 */
const ExcludeGroupsSchema = z.record(
  z.string().min(1).regex(/^[a-z][a-z0-9-]*$/, {
    message: 'group names must be lowercase kebab-case (a-z, 0-9, dashes), start with a letter',
  }),
  z.array(GlobStringSchema).readonly(),
);

const AcceptEntrySchema = z
  .object({
    ruleId: z.string().min(1),
    path: z.string().min(1),
    line: z.number().int().positive().optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();

const RuleOverrideSchema = z
  .object({
    severity: SeveritySchema.optional(),
    message: z.string().min(1).optional(),
  })
  .strict();

const RulesSectionSchema = z
  .object({
    detect: z.array(DetectRuleSpecSchema).readonly().default([]),
    fix: z.array(FixRuleSpecSchema).readonly().default([]),
    ast: z.array(AstRuleSpecSchema).readonly().default([]),
    transform: z.array(TransformRuleSpecSchema).readonly().default([]),
    /**
     * Format specs (#34a) — file-mutating tools the runner shells
     * out to (prettier --write, dotnet format, eslint --fix, ...).
     * `regent check` runs the `detect` argv (dry-run); `regent fix`
     * also runs `fix` (mutating). Discovery + bundle plumbing land
     * in 34c.
     */
    format: z.array(FormatRuleSpecSchema).readonly().default([]),
    /**
     * Delegate specs (#34a) — read-only analysis tools the runner
     * shells out to (eslint, ruff check, tsc --noEmit, ...). There
     * is no `fix` (delegates are observational). Both `regent check`
     * and `regent fix` run `detect` so users see new findings the
     * format step exposes.
     */
    delegate: z.array(DelegateRuleSpecSchema).readonly().default([]),
    // `extends` accepts paths, globs, or arrays of inline rules.
    // Resolution semantics are unchanged from v0.1; the schema just
    // surfaces the union type.
    extends: z
      .array(z.union([z.string().min(1), z.array(z.unknown()).readonly()]))
      .readonly()
      .default([]),
    disable: z.array(z.string().min(1)).readonly().default([]),
    override: z.record(z.string().min(1), RuleOverrideSchema).default({}),
    /**
     * Per-rule parameter values for `defineParameterizedRule`-shaped
     * rules (#33). Each key is a rule id; each value is an opaque
     * object validated against the rule's own `params` zod schema
     * (see `src/loader/parameterize.ts`). Values that no rule
     * references are an error at load time; default `{}` means
     * "all parameterised rules resolve with their schema defaults".
     *
     * Strict on shape: unknown rule ids with non-empty values are
     * rejected with a clear message; unknown rule ids with empty
     * values are silently ignored (lets projects roll out the
     * feature gradually without false-positive drift noise).
     */
    configure: z.record(z.string().min(1), z.unknown()).default({}),
    accept: z.array(AcceptEntrySchema).readonly().default([]),
  })
.strict()
  .default({
    detect: [],
    fix: [],
    ast: [],
    transform: [],
    format: [],
    delegate: [],
    extends: [],
    disable: [],
    override: {},
    configure: {},
    accept: [],
  });

export const RegentConfigSchema = z
  .object({
    rules: RulesSectionSchema,
    excludePaths: GlobListSchema.default([]),
    excludeGroups: ExcludeGroupsSchema.default({}),
    cache: z
      .object({
        enabled: z.boolean().default(true),
        maxBytes: z.number().int().positive().default(100 * 1024 * 1024),
        /**
         * Max age of a cache entry in milliseconds. Entries older than
         * `now - maxAge` are dropped on `DiskCache` load. Default: 7
         * days. A rule whose spec changes (or is removed) effectively
         * gets a fresh window because its new `ruleHash` won't hit
         * the cache, but stale entries can still linger and bloat the
         * cache; this TTL bounds that.
         */
        maxAge: z.number().int().positive().default(7 * 24 * 60 * 60 * 1000),
      })
      .strict()
      .default({
        enabled: true,
        maxBytes: 100 * 1024 * 1024,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      }),
    log: z
      .object({
        level: LogLevelSchema.default('info'),
        format: LogFormatSchema.default('text'),
      })
      .strict()
      .default({ level: 'info', format: 'text' }),
    output: z
      .object({
        color: z.boolean().default(true),
        contextBuffer: z.number().int().min(0).max(50).default(3),
      })
      .strict()
      .default({ color: true, contextBuffer: 3 }),
    runner: z
      .object({
        /**
         * Maximum number of files scanned in parallel. Each scan is
         * CPU-bound (regex + line scan) plus one async `readFile`;
         * the libuv threadpool defaults to 4. Override for
         * multi-core boxes via `STBL_REGENT_RUNNER_CONCURRENCY`
         * or `--concurrency N`.
         */
        concurrency: z.number().int().positive().default(4),
      })
      .strict()
      .default({ concurrency: 4 }),
  })
  .strict()
  .default({
    rules: {
      detect: [],
      fix: [],
      ast: [],
      transform: [],
      format: [],
      delegate: [],
      extends: [],
      disable: [],
      override: {},
      configure: {},
      accept: [],
    },
    excludePaths: [],
    excludeGroups: {},
    cache: { enabled: true, maxBytes: 100 * 1024 * 1024, maxAge: 7 * 24 * 60 * 60 * 1000 },
    log: { level: 'info', format: 'text' },
    output: { color: true, contextBuffer: 3 },
    runner: { concurrency: 4 },
  });

export type RegentConfig = z.infer<typeof RegentConfigSchema>;
export type DetectRuleSpec = z.infer<typeof DetectRuleSpecSchema>;
export type FixRuleSpec = z.infer<typeof FixRuleSpecSchema>;
export type TransformRuleSpec = z.infer<typeof TransformRuleSpecSchema>;

/**
 * Try to parse a candidate object against `RegentConfigSchema`. On
 * success returns `{ ok: true, value }`. On failure returns
 * `{ ok: false, error }` where `error` is a human-readable string
 * suitable for log/CLI output.
 */
export function safeParseConfig(input: unknown):
  | { ok: true; value: RegentConfig }
  | { ok: false; error: string } {
  const result = RegentConfigSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    error: formatZodError(result.error),
  };
}

function formatZodError(err: z.ZodError): string {
  const lines: string[] = [];
  for (const issue of err.issues) {
    const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
    lines.push(`  ${path}: ${issue.message}`);
  }
  return `regent config validation failed:\n${lines.join('\n')}`;
}
