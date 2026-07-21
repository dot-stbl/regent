/**
 * Example detect rule — `panic(` outside `main` and tests.
 *
 * `panic` in a library or handler is a process kill. Reserve it
 * for genuinely unrecoverable programmer errors.
 */
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'go.panic-in-prod',
  severity: 'warning',
  pattern: '\\bpanic\\s*\\(',
  globs: ['**/*.go'],
  excludePaths: [
    '**/main.go',
    '**/*_test.go',
    '**/testdata/**',
    '**/example/**',
    '**/examples/**',
  ],
  message:
    '`panic(` in a library or handler kills the process. Return ' +
    '`error` and let callers handle it; reserve `panic` for ' +
    'genuinely unrecoverable programmer errors.',
  source: 'error-handling.md#no-panic-in-prod',
  rationale:
    'A panicking handler or shared utility turns upstream bugs ' +
    'into whole-service outages. Returning `error` lets the caller ' +
    'log, retry, or convert to a 5xx without a process restart.',
});