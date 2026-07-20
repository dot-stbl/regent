/**
 * Test-local rule fixture — mirroring
 * `async-and-tasks.md#no-configureawait`.
 *
 * This file is intentionally under `test/rules/csharp/`, not
 * `regent/src/presets/csharp.ts` and not `~/.agents/rules/csharp/`.
 * It exists only as a test exercise for `test/fixtures.test.ts`.
 */
import { defineRule } from '../../../src/define-rule.js';

export default defineRule({
  id: 'csharp.async.configure-await',
  severity: 'error',
  pattern: '\\.ConfigureAwait\\s*\\(\\s*false\\s*\\)',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`.ConfigureAwait(false)` — ЗАПРЕЩЁН в app code.',
  source: 'async-and-tasks.md#no-configureawait',
  rationale: 'Adding `.ConfigureAwait(false)` in app code is a no-op in ASP.NET Core (no SynchronizationContext). Library code is exempt.',
});
