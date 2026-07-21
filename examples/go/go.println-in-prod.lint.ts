/**
 * Example detect rule — `fmt.Println` / `fmt.Printf` outside tests.
 *
 * Stdout is debug noise — production paths should use a logger
 * (`slog`, `logrus`, `zap`, ...).
 */
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'go.println-in-prod',
  severity: 'warning',
  pattern: '\\bfmt\\.(Print|Println|Printf|Println)\\s*\\(',
  globs: ['**/*.go'],
  excludePaths: ['**/*_test.go', '**/testdata/**'],
  message:
    '`fmt.Print*` in production code. Use a structured logger ' +
    '(`slog`, `logrus`, `zap`) so output is routable + filterable.',
  source: 'logging.md#no-fmt-print',
  rationale:
    'Stdout writes bypass the logger pipeline — no level, no sink ' +
    'config, no JSON support. In a server context this means ' +
    'operators see unstructured lines while structured logs land in ' +
    'the aggregator.',
});