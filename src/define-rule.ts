/**
 * Type-safe rule + config definition helpers.
 *
 * These wrappers exist purely for IDE-time feedback — they enforce no
 * runtime behaviour beyond freezing the object so accidental mutation
 * after definition fails loudly.
 */

import type { ConfigLayer, RuleSpec } from './types.js';

/**
 * Mark a rule definition as immutable + retain its narrowed type. The
 * `const T` preserves literal-property narrowing so `pattern` and
 * `message` retain their typed values.
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
