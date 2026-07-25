/**
 * One-off generator for the HTML reporter's golden snapshot.
 *
 * Usage:  node --experimental-strip-types scripts/gen-html-golden.ts
 *   or    npx tsx scripts/gen-html-golden.ts
 *
 * Writes test/__fixtures__/html/snapshot.html. Run only when the
 * reporter's output changes deliberately — the test then diffs the
 * committed golden against a fresh render, so the change shows up in
 * the PR review.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderHtml } from '../dist/reporter/html.js';
import type { Finding } from '../dist/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, '..');
const OUT = join(DOCS, 'test', '__fixtures__', 'html', 'snapshot.html');

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  ruleId: 'csharp.no-private-methods',
  severity: 'error',
  path: '/abs/repo/src/Foo.cs',
  match: {
    startLine: 41,
    startColumn: 4,
    endLine: 41,
    endColumn: 27,
    matchText: 'private void Bar() {',
  },
  context: {
    startLine: 39,
    endLine: 44,
    lines: [
      'public sealed class Foo',
      '{',
      '    private readonly ILogger _log;',
      '    private void Bar() {',
      '        return;',
      '    }',
    ],
  },
  message: 'no private methods in production code',
  source: 'code-shape.md#no-private-business-logic',
  ...overrides,
});

const findings: Finding[] = [
  baseFinding(),
  baseFinding({
    ruleId: 'csharp.no-region-directive',
    severity: 'warning',
    path: '/abs/repo/src/Foo.cs',
    match: { startLine: 4, startColumn: 0, endLine: 4, endColumn: 11, matchText: '    #region' },
    context: {
      startLine: 1,
      endLine: 7,
      lines: [
        'public class Foo',
        '{',
        '    int x;',
        '    #region',
        '    int y;',
        '    #endregion',
        '}',
      ],
    },
    message: '#region forbidden',
    source: 'code-shape.md#no-region',
  }),
  baseFinding({
    ruleId: 'meta.trailing-newline',
    severity: 'suggestion',
    path: '/abs/repo/src/Bar.cs',
    match: { startLine: 8, startColumn: 0, endLine: 8, endColumn: 1, matchText: '' },
    context: {
      startLine: 5,
      endLine: 9,
      lines: [
        'public class Bar',
        '{',
        '    int x;',
        '}',
        '',
      ],
    },
    message: 'file must end with a trailing newline',
    source: 'meta.md#trailing-newline',
    rationale: 'POSIX text files end with a newline so cat does not bleed into the next prompt.',
  }),
];

const out = renderHtml(
  { findings, rules: [], scannedFiles: 12 },
  { cwd: '/abs/repo', version: '0.5.2' },
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');
console.log(`wrote ${OUT} (${out.length} bytes)`);
