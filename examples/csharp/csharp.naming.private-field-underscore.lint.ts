/**
 * Example detect rule — private fields must NOT start with `_`.
 *
 * Mirrors `naming-and-types.md#no-underscore-prefix`. Use as a template
 * for naming-convention rules.
 */
import { defineRule } from '../../src/define-rule.js';

export default defineRule({
  id: 'csharp.naming.private-field-underscore',
  severity: 'error',
  pattern: '^\\s*private[^=\\n;]*_+\\s*[A-Za-z]\\w*\\s*[;=]',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: 'private fields must NOT start with `_`',
  source: 'naming-and-types.md#no-underscore-prefix',
  rationale:
    'Primary-constructor parameter names already serve as backing fields. Underscore-prefixed fields duplicate state without adding value.',
});
