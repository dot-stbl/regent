// Snapshot fixture — dry-run: same as single-replace but with
// `dryRun: true`. The engine returns the result but DOES NOT write
// to disk; the test runner verifies both.
import type { Finding, RuleSpec } from '../../../src/types.js';

const rule: RuleSpec = {
  id: 'snap.replace-hello',
  severity: 'warning',
  pattern: 'hello',
  globs: ['**/*.txt'],
  message: 'say hi loudly',
  fix: {
    kind: 'replace',
    safety: 'safe',
    title: 'snap.replace-hello',
    template: 'HELLO',
  },
};

export const rules: readonly RuleSpec[] = [rule];

export function buildFindings(content: string, filePath: string): readonly Finding[] {
  const idx = content.indexOf('hello');
  if (idx < 0) return [];
  return [
    {
      ruleId: rule.id,
      severity: rule.severity,
      path: filePath,
      match: {
        startLine: 0,
        startColumn: idx,
        endLine: 0,
        endColumn: idx + 5,
        matchText: 'hello',
        groups: [],
      },
      context: { startLine: 0, endLine: 0, lines: [content] },
      message: rule.message,
      source: 'test',
      status: 'violation',
    },
  ];
}