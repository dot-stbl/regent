import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'typescript.no-console',
  severity: 'warning',
  pattern: patterns.consoleLog().toRegex(),
  globs: ['**/*.ts', '**/*.tsx'],
  excludePaths: [
    '@generated',
    '@node-modules',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/scripts/**',
  ],
  message: '`console.log` left in production code — use a structured logger.',
  source: 'ts-and-styling.md#no-console',
  rationale:
    'console.log bypasses log levels, structured fields, and log routing. Use a logger (pino, winston) in production paths.',
});
