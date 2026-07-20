/**
 * Type-safe rule + config definition helpers.
 *
 * `defineRule` is the legacy v0.1 surface — it accepts a `RuleSpec`
 * and freezes it. New code should prefer `defineDetectRule` from
 * `./kinds/detect.js` (for `.lint.ts` rules) or `defineFixRule` from
 * `./kinds/fix.js` (for `.fix.ts` rules).
 *
 * These wrappers exist purely for IDE-time feedback — they enforce no
 * runtime behaviour beyond freezing the object so accidental mutation
 * after definition fails loudly.
 */

import type { ConfigLayer, RuleSpec } from './types.js';

/**
 * @deprecated Prefer `defineDetectRule` from `@dot-stbl/regent` for
 * new code. `defineRule` continues to work for `.lint.ts` and
 * `.rule.ts` files authored against the v0.1 surface.
 */
export function defineRule<const T extends RuleSpec>(rule: T): T {
  return Object.freeze(rule) as T;
}

/**
 * Mark a config as immutable. The loader merges config layers; each
 * layer is frozen to prevent mutation of the user's input.
 */
export function defineConfig<const T extends ConfigLayer>(config: T): T {
  return Object.freeze(config) as T;
}
