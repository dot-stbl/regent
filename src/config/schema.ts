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

const DetectRuleSpecSchema = z
  .object({
    id: z.string().min(1),
    severity: SeveritySchema,
    pattern: z.string().min(1),
    excludeWhen: z.string().optional(),
    globs: GlobListSchema,
    excludePaths: GlobListSchema.optional(),
    message: z.string().min(1),
    source: z.string().optional(),
    rationale: z.string().optional(),
    review: RuleReviewSpecSchema.optional(),
    dependsOn: z.array(z.string().min(1)).readonly().optional(),
  })
  .strict();

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
    // `extends` accepts paths, globs, or arrays of inline rules.
    // Resolution semantics are unchanged from v0.1; the schema just
    // surfaces the union type.
    extends: z
      .array(z.union([z.string().min(1), z.array(z.unknown()).readonly()]))
      .readonly()
      .default([]),
    disable: z.array(z.string().min(1)).readonly().default([]),
    override: z.record(z.string().min(1), RuleOverrideSchema).default({}),
    accept: z.array(AcceptEntrySchema).readonly().default([]),
  })
  .strict()
  .default({
    detect: [],
    fix: [],
    extends: [],
    disable: [],
    override: {},
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
      extends: [],
      disable: [],
      override: {},
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
