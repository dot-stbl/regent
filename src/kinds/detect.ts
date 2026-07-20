// `defineDetectRule` — type-safe detection rule.
//
// Pattern uses RE2 syntax — no backreferences, no lookbehind. Use
// `excludeWhen` to skip false positives (positive-match inversion,
// since RE2 has no negative lookahead).

import type { DetectRuleSpec } from '../config/schema.js';

export function defineDetectRule<const T extends DetectRuleSpec>(rule: T): T {
  return Object.freeze(rule) as T;
}