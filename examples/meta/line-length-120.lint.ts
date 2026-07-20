import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'meta.line-length-120',
  severity: 'suggestion',
  pattern: '^.{121,}$',
  globs: ['**/*.ts', '**/*.tsx', '**/*.cs', '**/*.py', '**/*.go', '**/*.rs', '**/*.js', '**/*.mjs'],
  excludePaths: ['@generated', '@node-modules', '@build-output'],
  message: 'line exceeds 120 characters — wrap or extract.',
  review: {
    enabled: true,
    exitBehavior: 'no-fail',
    guidance:
      '120 chars is a soft cap. Long lines are sometimes OK (URLs, regex); accept with reason if intentional.',
  },
});
