// Snapshot fixture — two overlapping edits. First-registered wins,
// second is deferred with reason='overlap' and winningRuleId set
// to the rule that won.
import type { Finding, RuleSpec } from '../../../src/types.js';

const ruleA: RuleSpec = {
  id: 'snap.first',
  severity: 'warning',
  pattern: 'hello',
  globs: ['**/*.txt'],
  message: 'a',
  fix: { kind: 'replace', safety: 'safe', title: 'snap.first', template: 'FIRST' },
};

const ruleB: RuleSpec = {
  id: 'snap.second',
  severity: 'warning',
  pattern: 'llo ',
  globs: ['**/*.txt'],
  message: 'b',
  fix: { kind: 'replace', safety: 'safe', title: 'snap.second', template: 'SECOND' },
};

export const rules: readonly RuleSpec[] = [ruleA, ruleB];

export function buildFindings(content: string, filePath: string): readonly Finding[] {
  const findings: Finding[] = [];
  const aIdx = content.indexOf('hello');
  if (aIdx >= 0) {
    findings.push({
      ruleId: ruleA.id,
      severity: ruleA.severity,
      path: filePath,
      match: {
        startLine: 0,
        startColumn: aIdx,
        endLine: 0,
        endColumn: aIdx + 5,
        matchText: 'hello',
        groups: [],
      },
      context: { startLine: 0, endLine: 0, lines: [content] },
      message: ruleA.message,
      source: 'test',
      status: 'violation',
    });
  }
  const bIdx = content.indexOf('llo ');
  if (bIdx >= 0) {
    findings.push({
      ruleId: ruleB.id,
      severity: ruleB.severity,
      path: filePath,
      match: {
        startLine: 0,
        startColumn: bIdx,
        endLine: 0,
        endColumn: bIdx + 4,
        matchText: 'llo ',
        groups: [],
      },
      context: { startLine: 0, endLine: 0, lines: [content] },
      message: ruleB.message,
      source: 'test',
      status: 'violation',
    });
  }
  return findings;
}