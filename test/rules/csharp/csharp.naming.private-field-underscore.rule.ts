/**
 * Test-local rule fixture — mirroring
 * `naming-and-types.md#private-fields-underscore-prefix`.
 *
 * This file is intentionally under `test/rules/csharp/`, not
 * `regent/src/presets/csharp.ts` and not `~/.agents/rules/csharp/`.
 * It exists only as a test exercise for `test/fixtures.test.ts`.
 */
import { defineRule } from '../../../src/define-rule.js';

export default defineRule({
  id: 'csharp.naming.private-field-underscore',
  severity: 'error',
  pattern: '^\\s*private[^=\\n;]*_+\\s*[A-Za-z]\\w*\\s*[;=]',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: 'private fields must NOT start with `_`',
  source: 'naming-and-types.md#no-underscore-prefix',
  rationale: 'Primary-constructor parameter names already serve as backing fields. Underscore-prefixed fields duplicate state without adding value.',
});
