// Snapshot fixture — fixpoint convergence. Rule A replaces 'foo'
// with 'Foo' (converges=true). Rule B matches 'Foo' and replaces
// with 'FOO' (converges=true). After pass 1 applies rule A, the
// re-scan in pass 2 finds rule B's match. After pass 2 the
// content 'FOO' matches neither rule, so the loop terminates.
// result.passes === 2.
import type { Finding, RuleSpec } from '../../../src/types.js';

const ruleA: RuleSpec = {
  id: 'snap.chain.a',
  severity: 'warning',
  pattern: 'foo',
  globs: ['**/*.txt'],
  message: 'a',
  fix: {
    kind: 'replace',
    safety: 'safe',
    title: 'snap.chain.a',
    template: 'Foo',
    converges: true,
  },
};

const ruleB: RuleSpec = {
  id: 'snap.chain.b',
  severity: 'warning',
  pattern: 'Foo',
  globs: ['**/*.txt'],
  message: 'b',
  fix: {
    kind: 'replace',
    safety: 'safe',
    title: 'snap.chain.b',
    template: 'FOO',
    converges: true,
  },
};

export const rules: readonly RuleSpec[] = [ruleA, ruleB];

export function buildFindings(content: string, filePath: string): readonly Finding[] {
  const idx = content.indexOf('foo');
  if (idx < 0) return [];
  return [
    {
      ruleId: ruleA.id,
      severity: ruleA.severity,
      path: filePath,
      match: {
        startLine: 0,
        startColumn: idx,
        endLine: 0,
        endColumn: idx + 3,
        matchText: 'foo',
        groups: [],
      },
      context: { startLine: 0, endLine: 0, lines: [content] },
      message: ruleA.message,
      source: 'test',
      status: 'violation',
    },
  ];
}