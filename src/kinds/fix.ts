// `defineFixRule` — type-safe auto-fix rule.
//
// `find` is a RE2 pattern. `replace` is the literal replacement
// string applied to every match. Idempotency contract: applying the
// fix once must produce a string that no longer matches `find` —
// otherwise `--check` reports a diff every run.
//
// Fix rules do NOT currently support a function-form `replace`; we
// keep the surface string-only to guarantee cache correctness (a
// non-pure function would defeat the content-hash cache).

import type { FixRuleSpec } from '../config/schema.js';

export function defineFixRule<const T extends FixRuleSpec>(rule: T): T {
  return Object.freeze(rule) as T;
}