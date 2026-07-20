/**
 * Example detect rule — `throw ex;` resets the stack trace.
 *
 * Mirrors `exceptions.md#stack-reset`. Use as a template for
 * exception-handling rules.
 */
import { defineRule } from '../../src/define-rule.js';

export default defineRule({
  id: 'csharp.exceptions.throw-variable',
  severity: 'error',
  pattern: '^\\s*throw\\s+[A-Za-z_]\\w+\\s*;',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**', '**/*.g.cs', '**/*.Designer.cs'],
  message: '`throw ex;` resets the stack trace. Use bare `throw;`.',
  source: 'exceptions.md#stack-reset',
  rationale:
    'Rethrowing via `throw ex;` resets the stack trace — bugs become hard to diagnose. Bare `throw;` preserves the original trace.',
});
