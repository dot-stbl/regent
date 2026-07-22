/**
 * Example detect rule — `System.out.println` in production code.
 *
 * Stdout is debug noise — production paths should use a logger.
 */
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'java.system-out',
  severity: 'warning',
  pattern: patterns.javaSystemOut().toRegex(),
  globs: ['**/*.java'],
  excludePaths: ['**/test/**', '**/tests/**'],
  message:
    '`System.out` / `System.err` in production code. Use a logger ' +
    '(SLF4J / Log4j / JUL) so output is routed + structured.',
  source: 'logging.md#no-system-out',
  rationale:
    'System.out writes to the JVM stdout stream with no level, no ' +
    'sink configuration, and no correlation id. A logger routes by ' +
    'level and is filterable at runtime.',
});