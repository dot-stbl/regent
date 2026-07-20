import { defineFixRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineFixRule({
  id: 'meta.no-trailing-whitespace',
  severity: 'warning',
  find: patterns.trailingWhitespace().toRegex(),
  replace: '',
  all: true,
  globs: ['**/*'],
  excludePaths: ['@generated', '@node-modules', '@build-output', '**/*.md'],
  message: 'strip trailing whitespace at end of line',
});
