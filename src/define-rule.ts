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

import type { z } from 'zod';

import type { RegentConfigSchema } from './config/schema.js';
import type { RuleSpec } from './types.js';

/**
 * Input type of the Zod schema — fields with `.default(...)` show up
 * as optional, so users can pass a partial config without TypeScript
 * demanding every defaulted field. `RegentConfig` (the `z.infer`
 * output) is what the runtime produces after defaults; that's not
 * what users write.
 */
type RegentConfigInput = z.input<typeof RegentConfigSchema>;

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
 *
 * Typed against the Zod *input* shape so every `.default(...)` field
 * (e.g. `rules.detect`, `rules.extends`, `rules.configure`) stays
 * optional in the IDE — users only have to provide what they want to
 * override. `RegentConfig` (the output type) would force every
 * defaulted field, which is wrong for the user-facing surface.
 */
export function defineConfig<const T extends RegentConfigInput>(config: T): T {
  return Object.freeze(config) as T;
}
