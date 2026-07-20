/**
 * L0: pure-unit — runner with mocked filesystem
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defineRule } from '../src/define-rule.js';
import { runRules } from '../src/runner.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_CWD = join(tmpdir(), `regent-runner-${Date.now()}`);

beforeAll(() => {
  mkdirSync(TEST_CWD, { recursive: true });
  writeFileSync(
    join(TEST_CWD, 'sample.cs'),
    [
      'public class A',
      '{',
      '    private readonly ILogger _log;',
      '    public A() {}',
      '    #region',
      '    public void Hello() { }',
      '    #endregion',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(TEST_CWD, 'clean.cs'),
    `public class A { int x; }\n`,
  );
  writeFileSync(
    join(TEST_CWD, 'ignore.md'),
    `#region`,
  );
});

afterAll(() => {
  rmSync(TEST_CWD, { recursive: true, force: true });
});

const NO_REGION = defineRule({
  id: 'runner.no-region',
  severity: 'error',
  pattern: '^\\s*#region\\b',
  globs: ['**/*.cs'],
  message: 'no #region',
  excludePaths: ['**/*.md'],
});

describe('runRules', () => {
  it('emits a finding on the matching line', async () => {
    const result = await runRules([NO_REGION], {
      cwd: TEST_CWD,
      includeGlobs: ['**/*.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.match.startLine).toBe(4);
    expect(result.findings[0]!.match.matchText).toContain('#region');
  });

  it('does not flag files matching excludePaths', async () => {
    const result = await runRules([NO_REGION], {
      cwd: TEST_CWD,
      includeGlobs: ['**/*'],
      excludeGlobs: ['**/*.md'],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    const flagged = result.findings.filter((f) => f.path.endsWith('.md'));
    expect(flagged).toHaveLength(0);
  });

  it('extracts DEFAULT_CONTEXT_BUFFER (3) lines of context', async () => {
    const result = await runRules([NO_REGION], {
      cwd: TEST_CWD,
      includeGlobs: ['**/*.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    expect(result.findings[0]!.context.lines.length).toBe(7);  // start-3..end+3
  });

  it('returns zero findings for clean input', async () => {
    const result = await runRules([NO_REGION], {
      cwd: TEST_CWD,
      includeGlobs: ['clean.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    expect(result.findings).toHaveLength(0);
  });
});
