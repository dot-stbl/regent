/**
 * Example detect rule — `_ =` discard assignment at statement start.
 *
 * Mirrors `async-and-tasks.md#no-discard`. Use as a template for
 * similar async-shape rules.
 */
import { defineRule } from '@dot-stbl/regent';

export default defineRule({
  id: 'csharp.async.discard-assignment',
  severity: 'error',
  pattern: '^\\s*_\\s*=\\s*',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`_ = …` explicit assignment discard is noise.',
  source: 'async-and-tasks.md#no-discard',
  rationale:
    'The `_ =` prefix discards a return value the runtime ignores anyway. Awaiting bare async yields the same effect without the discard.',
});
