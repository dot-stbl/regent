/**
 * Test-local rule fixture — mirroring `async-and-tasks.md#no-result` (chain form).
 *
 * This file is intentionally under `test/rules/csharp/`, not
 * `regent/src/presets/csharp.ts` and not `~/.agents/rules/csharp/`.
 * It exists only as a test exercise for `test/fixtures.test.ts`.
 */
import { defineRule } from '../../../src/define-rule.js';

export default defineRule({
  id: 'csharp.async.getawaiter-blocking',
  severity: 'error',
  pattern: '\\.GetAwaiter\\s*\\(\\s*\\)\\s*\\.GetResult\\s*\\(\\s*\\)',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`.GetAwaiter().GetResult()` — sync-over-async deadlock risk (VSTHRD103).',
  source: 'async-and-tasks.md#no-result',
  rationale: 'Same deadlock family as `.Result` — `.GetAwaiter().GetResult()` is the polite form of the same mistake. Await the task.',
});
