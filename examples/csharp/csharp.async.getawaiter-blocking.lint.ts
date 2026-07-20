/**
 * Example detect rule — `.GetAwaiter().GetResult()` blocks the sync context.
 *
 * Mirrors `async-and-tasks.md#no-result` (chain form). Use as a template
 * for blocking-call rules.
 */
import { defineRule } from '@dot-stbl/regent';

export default defineRule({
  id: 'csharp.async.getawaiter-blocking',
  severity: 'error',
  pattern: '\\.GetAwaiter\\s*\\(\\s*\\)\\s*\\.GetResult\\s*\\(\\s*\\)',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`.GetAwaiter().GetResult()` — sync-over-async deadlock risk (VSTHRD103).',
  source: 'async-and-tasks.md#no-result',
  rationale:
    'Same deadlock family as `.Result` — `.GetAwaiter().GetResult()` is the polite form of the same mistake. Await the task.',
});
