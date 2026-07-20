/**
 * Example detect rule — `.ConfigureAwait(false)` is banned in app code.
 *
 * Mirrors `async-and-tasks.md#no-configureawait`. Use this as a template
 * for similar async rules in your project. Browse all C# examples via
 * `regent llm examples csharp`.
 */
import { defineRule } from '@dot-stbl/regent';

export default defineRule({
  id: 'csharp.async.configure-await',
  severity: 'error',
  pattern: '\\.ConfigureAwait\\s*\\(\\s*false\\s*\\)',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`.ConfigureAwait(false)` is banned in app code.',
  source: 'async-and-tasks.md#no-configureawait',
  rationale:
    'Adding `.ConfigureAwait(false)` in app code is a no-op in ASP.NET Core (no SynchronizationContext). Library code is exempt.',
});
