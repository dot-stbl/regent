import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'typescript.no-any',
  severity: 'warning',
  pattern: patterns.tsAnyType().toRegex(),
  globs: ['**/*.ts', '**/*.tsx'],
  excludePaths: ['@generated', '@node-modules', '**/*.d.ts'],
  message: '`any` type is banned — use a specific type or `unknown`.',
  source: 'ts-and-styling.md#no-any',
  rationale:
    '`any` defeats the purpose of TypeScript. Use `unknown` (forces narrowing) or a specific type.',
});
