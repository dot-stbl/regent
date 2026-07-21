// `defineTransformRule` — type-safe programmatic whole-file rewrite.
//
// `transform(filePath, content) → string` rewrites the file content.
// MUST be pure + deterministic — non-pure functions defeat the
// content-hash cache and make `--check` non-idempotent.
//
// Run-time invocation (in the runner pipeline) lands in #25.
// Until then, transform rules are loaded and validated, but the
// runner does not invoke the transform function. The shape is
// locked in here so #25 can wire it without a breaking change.

import type { TransformRuleSpec } from '../config/schema.js';
import type { RuleOrigin } from '../types.js';

export function defineTransformRule<const T extends TransformRuleSpec>(
  rule: T & {
    /** Pure + deterministic file content rewriter. */
    transform: (filePath: string, content: string) => string;
  },
): T & { transform: (filePath: string, content: string) => string } {
  return Object.freeze(rule) as T & {
    transform: (filePath: string, content: string) => string;
  };
}

/**
 * A loaded transform rule ready for the runner (the `transform`-kind
 * analog of CompiledRule). The runner does not invoke `transform`
 * yet — #25 wires it into the pipeline. Until then, callers can
 * read `spec` to confirm registration.
 */
export interface CompiledTransformRule {
  readonly spec: TransformRuleSpec & {
    transform: (filePath: string, content: string) => string;
  };
  readonly source: string;
  readonly origin: RuleOrigin;
}