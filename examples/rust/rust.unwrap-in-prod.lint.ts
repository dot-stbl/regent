/**
 * Example detect rule — `.unwrap()` outside tests / examples.
 *
 * `unwrap` panics on `None` / `Err`. Fine in tests (failure should
 * be loud); suspect in production code where graceful error
 * handling or `?` propagation is preferable.
 */
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'rust.unwrap-in-prod',
  severity: 'warning',
  pattern: '\\.unwrap\\s*\\(',
  excludeWhen: '^\\s*//',
  globs: ['**/*.rs'],
  excludePaths: [
    '**/tests/**',
    '**/benches/**',
    '**/examples/**',
    '**/test_*.rs',
    '**/*_test.rs',
  ],
  message:
    '`.unwrap()` in production code panics on `None` / `Err`. Prefer ' +
    '`?` propagation, `unwrap_or`, or explicit error handling.',
  source: 'error-handling.md#no-unwrap',
  rationale:
    'Production code that unwraps results translates upstream failures ' +
    'into 500s at the boundary. Reserve `.unwrap()` for tests where ' +
    'a failure is the expected signal.',
});