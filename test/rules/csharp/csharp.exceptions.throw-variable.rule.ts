/**
 * Test-local rule fixture — mirroring `exceptions.md#stack-reset`.
 *
 * This file is intentionally under `test/rules/csharp/`, not
 * `regent/src/presets/csharp.ts` and not `~/.agents/rules/csharp/`.
 * It exists only as a test exercise for `test/fixtures.test.ts`.
 */
import { defineRule } from '../../../src/define-rule.js';

export default defineRule({
  id: 'csharp.exceptions.throw-variable',
  severity: 'error',
  pattern: '^\\s*throw\\s+[A-Za-z_]\\w+\\s*;',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**', '**/*.g.cs', '**/*.Designer.cs'],
  message: '`throw ex;` — ❌ resets the stack. Use bare `throw;`.',
  source: 'exceptions.md#stack-reset',
  rationale: 'Rethrowing via `throw ex;` resets the stack trace — bugs become hard to diagnose. Bare `throw;` preserves the original trace.',
});
