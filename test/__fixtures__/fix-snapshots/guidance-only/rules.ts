// Snapshot fixture — `kind: 'guidance-only'` fix. Always surfaces
// in suggested[] with proposedEdit: null, regardless of lane.
import type { Finding, RuleSpec } from '../../../src/types.js';

const rule: RuleSpec = {
  id: 'snap.guidance',
  severity: 'warning',
  pattern: 'TODO',
  globs: ['**/*.ts'],
  message: 'fix the TODO',
  fix: {
    kind: 'guidance-only',
    safety: 'safe',
    title: 'snap.guidance',
    guidance: 'Replace this TODO with a real implementation.',
  },
};

export const rules: readonly RuleSpec[] = [rule];

export function buildFindings(content: string, filePath: string): readonly Finding[] {
  const idx = content.indexOf('TODO');
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
        endColumn: idx + 4,
        matchText: 'TODO',
        groups: [],
      },
      context: { startLine: 0, endLine: 0, lines: [content] },
      message: rule.message,
      source: 'test',
      status: 'violation',
    },
  ];
}