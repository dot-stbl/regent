import { defineFixRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineFixRule({
  id: 'meta.trailing-newline',
  severity: 'warning',
  find: patterns.finalNewlineMissing().toRegex(),
  replace: '\n',
  all: false,
  globs: ['**/*'],
  excludePaths: ['@generated', '@node-modules', '@build-output'],
  message: 'ensure file ends with a single newline',
});
