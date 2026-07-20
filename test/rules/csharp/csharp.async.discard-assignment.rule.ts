/**
 * Test-local rule fixture — mirroring `async-and-tasks.md#no-discard`.
 *
 * This file is intentionally under `test/rules/csharp/`, not
 * `regent/src/presets/csharp.ts` and not `~/.agents/rules/csharp/`.
 * It exists only as a test exercise for `test/fixtures.test.ts`.
 */
import { defineRule } from '../../../src/define-rule.js';

export default defineRule({
  id: 'csharp.async.discard-assignment',
  severity: 'error',
  pattern: '^\\s*_\\s*=\\s*',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`_ = …` — explicit assignment discard is noise.',
  source: 'async-and-tasks.md#no-discard',
  rationale: 'The `_ =` prefix discards a return value the runtime ignores anyway. Awaiting bare async yields the same effect without the discard.',
});
