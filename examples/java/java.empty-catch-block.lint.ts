/**
 * Example detect rule — empty catch blocks.
 *
 * `catch (X e) {}` silently swallows exceptions. At minimum, log;
 * usually, propagate or convert to a domain error.
 */
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'java.empty-catch-block',
  severity: 'warning',
  pattern: '\\bcatch\\s*\\([^)]+\\)\\s*\\{\\s*\\}',
  excludePaths: ['**/test/**', '**/tests/**'],
  globs: ['**/*.java'],
  message:
    'Empty `catch` block silently swallows the exception. Log, ' +
    'rethrow, or convert to a domain error.',
  source: 'exceptions.md#no-empty-catch',
  rationale:
    'A swallowed exception is invisible to operators — the symptom ' +
    'shows up as a "stuck" downstream call without any diagnostic ' +
    'signal. Logging or propagating is the minimum fix.',
});