/**
 * L2: rule fixture tests
 *
 * Each rule gets a `bad.<ext>` (must match) and `good.<ext>` (must NOT
 * match) fixture. Both live under `test/fixtures/<rule-id>/`.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defineRule } from '../src/define-rule.js';
import { runRules } from '../src/runner.js';

const TEST_DIR = join(tmpdir(), `regent-fixture-${Date.now()}`);

beforeAll(() => {
  mkdirSync(join(TEST_DIR, 'no-region'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'no-private-methods'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'mixed-overrides'), { recursive: true });

  writeFileSync(
    join(TEST_DIR, 'no-region', 'bad.cs'),
    [
      'namespace Test;',
      'public class A',
      '{',
      '    #region Properties',
      '    int x;',
      '    #endregion',
      '}',
    ].join('\n'),
  );
  writeFileSync(
    join(TEST_DIR, 'no-region', 'good.cs'),
    [
      'namespace Test;',
      'public class A',
      '{',
      '    int x;',
      '}',
    ].join('\n'),
  );

  writeFileSync(
    join(TEST_DIR, 'no-private-methods', 'bad.cs'),
    [
      'namespace Test;',
      'public class A',
      '{',
      '    private int _value;',
      '    private void DoWork() { _value = 42; }',
      '}',
    ].join('\n'),
  );
  writeFileSync(
    join(TEST_DIR, 'no-private-methods', 'good.cs'),
    [
      'namespace Test;',
      'public class A',
      '{',
      '    public void DoWork() { System.Console.WriteLine(42); }',
      '}',
    ].join('\n'),
  );

  // override scenario
  writeFileSync(
    join(TEST_DIR, 'mixed-overrides', 'override.cs'),
    [
      'namespace Test;',
      'public class A',
      '{',
      '    public override void DoWork() { }',
      '}',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

const NO_REGION = defineRule({
  id: 'fixture.no-region',
  severity: 'error',
  pattern: '^\\s*#region\\b',
  globs: ['**/*.cs'],
  message: 'no #region',
});

const NO_PRIVATE = defineRule({
  id: 'fixture.no-private-methods',
  severity: 'error',
  pattern: '^\\s*private\\s+(?:static\\s+)?(?:async\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\\s+)+[A-Za-z_][A-Za-z0-9_]*\\s*\\(',
  excludeWhen: '\\boverride\\b',
  globs: ['**/*.cs'],
  message: 'no private methods',
});

describe('rule fixtures', () => {
  it('no-region: flags bad.cs, ignores good.cs', async () => {
    const result = await runRules([NO_REGION], {
      cwd: join(TEST_DIR, 'no-region'),
      includeGlobs: ['**/*.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    expect(result.findings.some((f) => f.path.includes('bad.cs'))).toBe(true);
    expect(result.findings.some((f) => f.path.includes('good.cs'))).toBe(false);
  });

  it('no-private-methods: flags bad.cs, ignores good.cs', async () => {
    const result = await runRules([NO_PRIVATE], {
      cwd: join(TEST_DIR, 'no-private-methods'),
      includeGlobs: ['**/*.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    expect(result.findings.some((f) => f.path.includes('bad.cs'))).toBe(true);
    expect(result.findings.some((f) => f.path.includes('good.cs'))).toBe(false);
  });

  it('no-private-methods excludeWhen: skips override-method lines', async () => {
    const result = await runRules([NO_PRIVATE], {
      cwd: join(TEST_DIR, 'mixed-overrides'),
      includeGlobs: ['**/*.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    expect(result.findings).toHaveLength(0);
  });
});

void mkdtempSync;
