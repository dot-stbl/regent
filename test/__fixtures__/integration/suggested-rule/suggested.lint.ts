/**
 * Throwaway integration-test fixture for the `safety: 'suggested'` lane.
 *
 * Phase 8 of the fix-mode epic (#65) needs a rule whose fix lands in
 * the `suggested[]` lane rather than `applied[]`. No shipped example
 * carries that safety profile (see issue #62 P5 commit for the
 * shipped examples), so we ship a tiny in-repo fixture here.
 *
 * The test copies this file into the tmpdir under `tools/audit/rules/`
 * so the loader picks it up like a normal repo-local rule. The bare
 * specifier `import { defineRule } from '@dot-stbl/regent'` resolves
 * via the tmpdir's `node_modules/@dot-stbl/regent` symlink the test
 * setup creates (mirrors the npm-installed scenario for real users).
 */
import { defineRule } from '@dot-stbl/regent';

export default defineRule({
  id: 'cli-integration.suggested-fixture',
  severity: 'warning',
  pattern: 'TARGET_SUGGESTED',
  globs: ['**/*.txt'],
  message: 'TARGET_SUGGESTED is suggested for removal.',
  source: 'fix-mode-p8-integration-test',
  fix: {
    kind: 'replace',
    safety: 'suggested',
    title: 'remove TARGET_SUGGESTED marker',
    template: '',
  },
});