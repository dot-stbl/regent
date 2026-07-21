/**
 * JSON Schema emitters for `regent llm schema <kind> --json`.
 *
 * `zod-to-json-schema` 3.25 understands the zod v3 API, while `RegentConfigSchema`
 * in `src/config/schema.ts` is authored with zod v4 (which uses a different
 * internal representation that v3-targeted tooling can't introspect).
 * We therefore mirror just the two schemas the CLI exposes (`detect`,
 * `fix`) in v3 form here. The two definitions are kept intentionally small
 * and structural-only — they describe the *shape* of a rule spec for an
 * LLM agent to generate valid configs.
 *
 * Output is JSON Schema 2019-09 (the upstream `zod-to-json-schema` target),
 * which is byte-compatible with 2020-12 for our simple non-recursive
 * object shapes. We override `$schema` to point at 2020-12 to match the
 * contract in issue #14; ajv / `JSON.parse` consumers treat both as
 * identical for this shape.
 */

import { z } from 'zod/v3';
import { zodToJsonSchema } from 'zod-to-json-schema';

const SeveritySchema = z.enum(['error', 'warning', 'suggestion']);

const RuleReviewSpecSchema = z
  .object({
    enabled: z.boolean(),
    guidance: z.string().optional(),
    exitBehavior: z.enum(['no-fail', 'unreviewed-fails']).optional(),
  })
  .strict();

/**
 * v3-compatible mirror of `DetectRuleSpecSchema` (zod v4) from
 * `src/config/schema.ts`. Field-for-field parity, not a derivation —
 * the v4 source remains the canonical validator; this is a separate
 * zod v3 schema built for `zod-to-json-schema` consumption.
 */
const DetectRuleSpecV3Schema = z
  .object({
    id: z.string().min(1),
    severity: SeveritySchema,
    pattern: z.string().min(1),
    excludeWhen: z.string().optional(),
    globs: z.array(z.string().min(1)),
    excludePaths: z.array(z.string().min(1)).optional(),
    message: z.string().min(1),
    source: z.string().optional(),
    rationale: z.string().optional(),
    review: RuleReviewSpecSchema.optional(),
    dependsOn: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * v3-compatible mirror of `FixRuleSpecSchema`. Detect-only fields
 * (`pattern`, `excludeWhen`) are absent; fix-specific fields
 * (`find`, `replace`, `all`) take their place.
 */
const FixRuleSpecV3Schema = z
  .object({
    id: z.string().min(1),
    severity: SeveritySchema,
    find: z.string().min(1),
    replace: z.string(),
    all: z.boolean().optional(),
    globs: z.array(z.string().min(1)),
    excludePaths: z.array(z.string().min(1)).optional(),
    message: z.string().min(1),
    dependsOn: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * Build a JSON Schema document for a v3 Zod schema. Sets `$schema` to
 * 2020-12 (functionally equivalent to the upstream 2019-09 output for
 * our simple object shapes — see file header).
 */
function toJsonDocument<T extends z.ZodTypeAny>(
  schema: T,
  options: { name: string; title: string; description: string },
): Record<string, unknown> {
  const generated = zodToJsonSchema(schema, {
    name: options.name,
    target: 'jsonSchema2019-09',
    $refStrategy: 'root',
    // mark required fields explicitly
    errorMessages: false,
  }) as Record<string, unknown>;

  // Override the upstream `$schema` URL to 2020-12 (issue #14 contract).
  // 2019-09 → 2020-12 only changed `$defs` / `$id` semantics; our output
  // uses neither, so the document is byte-compatible.
  return {
    ...generated,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: options.title,
    description: options.description,
  };
}

/**
 * Render the `DetectRuleSpec` JSON Schema document (issue #14).
 */
export function renderDetectSchemaJson(): string {
  const doc = toJsonDocument(DetectRuleSpecV3Schema, {
    name: 'DetectRuleSpec',
    title: 'regent detect-rule spec',
    description:
      'Shape of a detect-mode rule inside `config.rules.detect[]`. '
      + 'Pattern matches against file contents; produces findings only.',
  });
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * Render the `FixRuleSpec` JSON Schema document (issue #14).
 */
export function renderFixSchemaJson(): string {
  const doc = toJsonDocument(FixRuleSpecV3Schema, {
    name: 'FixRuleSpec',
    title: 'regent fix-rule spec',
    description:
      'Shape of a fix-mode rule inside `config.rules.fix[]`. '
      + 'Pattern matches against file contents; replaces matches with `replace`.',
  });
  return JSON.stringify(doc, null, 2) + '\n';
}