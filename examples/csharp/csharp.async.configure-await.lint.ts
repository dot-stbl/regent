/**
 * Example detect rule — `.ConfigureAwait(false)` is banned in app code.
 *
 * Mirrors `async-and-tasks.md#no-configureawait`. Use this as a template
 * for similar async rules in your project. Browse all C# examples via
 * `regent llm examples csharp`.
 *
 * The `fix` attachment (P5 #62) deletes the matched substring so
 * `regent fix` can scrub the `.ConfigureAwait(false)` call in place.
 * The post-fix file has an empty-statement `;` where the call used
 * to sit — a single empty statement is legal C# but stylistically
 * noisy; the good fixture demonstrates the chain-on-one-line shape
 * that human editors typically aim for.
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
  fix: { kind: 'replace', safety: 'safe', title: 'csharp.async.configure-await', template: '' },
});
