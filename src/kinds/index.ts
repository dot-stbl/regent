// Re-exports for the public surface.

export { defineDetectRule } from './detect.js';
export { defineFixRule } from './fix.js';
export {
  defineTransformRule,
  type CompiledTransformRule,
} from './transform.js';
export { defineAstRule, type AstRuleSpec, type CompiledAstRule } from './ast.js';
export { defineRule as _legacyDefineRule } from '../define-rule.js';