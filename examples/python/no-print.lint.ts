import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'python.no-print',
  severity: 'suggestion',
  pattern: '^\\s*print\\s*\\(',
  globs: ['**/*.py'],
  excludePaths: [
    '@generated',
    '**/tests/**',
    '**/test_*.py',
    '**/*_test.py',
    '**/conftest.py',
    '**/migrations/**',
    '**/scripts/**',
  ],
  message: '`print(...)` left in production code — use a logger.',
  source: 'py-and-styling.md#no-print',
  rationale:
    'print bypasses log levels, structured fields, and log routing. Use the standard `logging` module in production paths.',
});
