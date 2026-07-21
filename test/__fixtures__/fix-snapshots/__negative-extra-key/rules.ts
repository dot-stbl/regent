// Negative-case fixture — `expected.json` carries an extra
// top-level key (`cwd`) which the v1 schema forbids. The runner
// MUST reject this fixture as a schema violation.
import type { Finding, RuleSpec } from '../../../src/types.js';

const rule: RuleSpec = {
  id: 'snap.neg',
  severity: 'warning',
  pattern: 'hello',
  globs: ['**/*.txt'],
  message: 'a',
  fix: {
    kind: 'replace',
    safety: 'safe',
    title: 'snap.neg',
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