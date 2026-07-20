/**
 * Example detect rule — `.Result` synchronously blocks the task.
 *
 * Mirrors `async-and-tasks.md#no-result`. Use as a template for
 * blocking-call rules.
 */
import { defineRule } from '@dot-stbl/regent';

export default defineRule({
  id: 'csharp.async.result-blocking',
  severity: 'error',
  pattern: '\\.\\s*Result\\b',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`.Result` — sync-over-async deadlock risk (VSTHRD103).',
  source: 'async-and-tasks.md#no-result',
  rationale:
    'Synchronously blocking on a Task creates a deadlock when the SynchronizationContext is needed. Await the task instead.',
});
