// Snapshot fixture — two replace edits on the same file. Both
// matches are independent (no overlap), so both should land.
import type { Finding, RuleSpec } from '../../../src/types.js';

const ruleA: RuleSpec = {
  id: 'snap.hello',
  severity: 'warning',
  pattern: 'hello',
  globs: ['**/*.txt'],
  message: 'a',
  fix: { kind: 'replace', safety: 'safe', title: 'snap.hello', template: 'HELLO' },
};

const ruleB: RuleSpec = {
  id: 'snap.world',
  severity: 'warning',
  pattern: 'world',
  globs: ['**/*.txt'],
  message: 'b',
  fix: { kind: 'replace', safety: 'safe', title: 'snap.world', template: 'WORLD' },
};

export const rules: readonly RuleSpec[] = [ruleA, ruleB];

export function buildFindings(content: string, filePath: string): readonly Finding[] {
  const findings: Finding[] = [];
  for (const [rule, pattern] of [[ruleA, 'hello'], [ruleB, 'world']] as const) {
    const idx = content.indexOf(pattern);
    if (idx < 0) continue;
    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      path: filePath,
      match: {
        startLine: 0,
        startColumn: idx,
        endLine: 0,
        endColumn: idx + pattern.length,
        matchText: pattern,
        groups: [],
      },
      context: { startLine: 0, endLine: 0, lines: [content] },
      message: rule.message,
      source: 'test',
      status: 'violation',
    });
  }
  return findings;
}