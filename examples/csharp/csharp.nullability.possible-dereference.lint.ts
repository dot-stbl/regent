import { defineAstRule } from '@dot-stbl/regent';

export default defineAstRule({
  id: 'csharp.nullability.possible-dereference',
  language: 'csharp',
  severity: 'warning',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: 'possible null dereference requires semantic analysis',
  source: 'nullability.md',
  ast: { rule: { pattern: '$VALUE' } },
  needsNative: { tool: 'roslyn-analyzers', analyzer: 'CS8602', guidance: 'Run nullable analysis.' },
});
