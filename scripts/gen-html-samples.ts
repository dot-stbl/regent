/**
 * One-off sample generator for a 3-finding + 50-finding HTML report.
 *
 * Writes to test-artifacts/ and reports the byte count. NOT committed
 * to the repo — used only for the owner's review pass.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderHtml } from '../dist/reporter/html.js';
import type { Finding } from '../dist/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, '..');
const ARTIFACTS = join(DOCS, 'test-artifacts');

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

const three: Finding[] = [
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
      lines: ['public class Bar', '{', '    int x;', '}', ''],
    },
    message: 'file must end with a trailing newline',
    source: 'meta.md#trailing-newline',
  }),
];

const fifty: Finding[] = Array.from({ length: 50 }, (_, i) =>
  baseFinding({
    ruleId: `csharp.no-private-methods-${i}`,
    message: `custom message for finding #${i}`,
    path: `/abs/repo/src/SomeFile${i}.cs`,
    match: { startLine: 10 + i, startColumn: 4, endLine: 10 + i, endColumn: 30, matchText: 'x' },
    context: {
      startLine: 8 + i,
      endLine: 14 + i,
      lines: [
        'public sealed class SomeFile' + i,
        '{',
        '    private readonly ILogger _log;',
        '    private void Bar() {',
        '        return;',
        '    }',
        '}',
      ],
    },
  }),
);

mkdirSync(ARTIFACTS, { recursive: true });

const threeOut = renderHtml(
  { findings: three, rules: [], scannedFiles: 12 },
  { cwd: '/abs/repo', version: '0.5.2' },
);
writeFileSync(join(ARTIFACTS, 'sample-3.html'), threeOut, 'utf8');
console.log(`3-finding report: ${threeOut.length} bytes -> ${join(ARTIFACTS, 'sample-3.html')}`);

const fiftyOut = renderHtml(
  { findings: fifty, rules: [], scannedFiles: 100 },
  { cwd: '/abs/repo', version: '0.5.2' },
);
writeFileSync(join(ARTIFACTS, 'sample-50.html'), fiftyOut, 'utf8');
console.log(`50-finding report: ${fiftyOut.length} bytes -> ${join(ARTIFACTS, 'sample-50.html')}`);

const first30 = threeOut.split('\n').slice(0, 30).join('\n');
console.log('\n--- first 30 lines of sample-3.html ---');
console.log(first30);
