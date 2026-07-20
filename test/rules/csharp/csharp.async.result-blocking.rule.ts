/**
 * Test-local rule fixture — mirroring `async-and-tasks.md#no-result`.
 *
 * This file is intentionally under `test/rules/csharp/`, not
 * `regent/src/presets/csharp.ts` and not `~/.agents/rules/csharp/`.
 * It exists only as a test exercise for `test/fixtures.test.ts`.
 */
import { defineRule } from '../../../src/define-rule.js';

export default defineRule({
  id: 'csharp.async.result-blocking',
  severity: 'error',
  pattern: '\\.\\s*Result\\b',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`.Result` — sync-over-async deadlock risk (VSTHRD103).',
  source: 'async-and-tasks.md#no-result',
  rationale: 'Synchronously blocking on a Task creates a deadlock when the SynchronizationContext is needed. Await or `.GetAwaiter().GetResult()` (which is also banned) instead.',
});
