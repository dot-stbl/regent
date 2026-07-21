/**
 * L2: rule fixture tests
 *
 * Each rule gets a `bad.<ext>` (must match) and `good.<ext>` (must NOT
 * match) fixture. Both live under `test/fixtures/<rule-id>/`.
 *
 * The first describe block uses fixtures written inline into a tmpdir
 * (legacy from the original MVP). Subsequent describe blocks cover
 * strict-error rules shipped as test-local rule fixtures under
 * `test/rules/csharp/`.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defineRule } from '../src/define-rule.js';
import { runRules } from '../src/runner.js';

// Example rules shipped under `examples/csharp/` (NOT auto-loaded by
// regent — these are public-facing samples an LLM agent can copy via
// `regent example copy csharp <rule-id>`). Used here as test fixtures.
import throwVarRule from '../examples/csharp/csharp.exceptions.throw-variable.lint.js';
import braceStyleRule from '../examples/csharp/csharp.exceptions.brace-style.lint.js';
import resultBlockingRule
  from '../examples/csharp/csharp.async.result-blocking.lint.js';
import getAwaiterBlockingRule
  from '../examples/csharp/csharp.async.getawaiter-blocking.lint.js';
import discardAssignmentRule
  from '../examples/csharp/csharp.async.discard-assignment.lint.js';
import configureAwaitRule
  from '../examples/csharp/csharp.async.configure-await.lint.js';
import privateFieldUnderscoreRule
  from '../examples/csharp/csharp.naming.private-field-underscore.lint.js';
import bareHttpClientRule
  from '../examples/csharp/csharp.http.bare-httpclient.lint.js';

const TEST_DIR = join(tmpdir(), `regent-fixture-${Date.now()}`);
const FIXTURES_DIR = join(import.meta.dirname ?? __dirname, '..', 'examples', 'csharp', '__fixtures__');

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

describe('rule fixtures (legacy MVP)', () => {
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

/**
 * Helper: run a single rule against a fixture directory on disk.
 * Each rule's bad.cs MUST trigger the rule; good.cs MUST NOT.
 */
async function expectRuleOnFixture(
  rule: { id: string; globs: readonly string[] },
  fixtureSubdir: string,
  ruleIdForError: string,
): Promise<{ passed: boolean; badFindings: number; goodFindings: number; reason?: string }> {
  const dir = join(FIXTURES_DIR, fixtureSubdir);
  const result = await runRules([rule], {
    cwd: dir,
    includeGlobs: rule.globs,
    excludeGlobs: [],
    changedOnly: false,
    diffBase: 'HEAD',
  });

  const badFindings = result.findings.filter((f) => f.path.endsWith('bad.cs')).length;
  const goodFindings = result.findings.filter((f) => f.path.endsWith('good.cs')).length;

  if (badFindings === 0) {
    return {
      passed: false,
      badFindings,
      goodFindings,
      reason: `${ruleIdForError}: expected at least one finding in bad.cs, got 0`,
    };
  }
  if (goodFindings > 0) {
    return {
      passed: false,
      badFindings,
      goodFindings,
      reason: `${ruleIdForError}: expected 0 findings in good.cs, got ${goodFindings}`,
    };
  }
  return { passed: true, badFindings, goodFindings };
}

describe('csharp.exceptions.brace-style', () => {
  it('flags a trailing closing brace; ignores braces on their own lines', async () => {
    const result = await expectRuleOnFixture(
      braceStyleRule,
      'csharp.exceptions.brace-style',
      'csharp.exceptions.brace-style',
    );
    expect(result.passed, result.reason).toBe(true);
  });
});

describe('csharp.exceptions.throw-variable', () => {
  it('flags throw ex; in catch; ignores throw new ...', async () => {
    const result = await expectRuleOnFixture(
      throwVarRule,
      'csharp.exceptions.throw-variable',
      'csharp.exceptions.throw-variable',
    );
    expect(result.passed, result.reason).toBe(true);
  });
});

describe('csharp.async.result-blocking', () => {
  it('flags .Result; ignores await', async () => {
    const result = await expectRuleOnFixture(
      resultBlockingRule,
      'csharp.async.result-blocking',
      'csharp.async.result-blocking',
    );
    expect(result.passed, result.reason).toBe(true);
  });
});

describe('csharp.async.getawaiter-blocking', () => {
  it('flags the chain; ignores async/await', async () => {
    const result = await expectRuleOnFixture(
      getAwaiterBlockingRule,
      'csharp.async.getawaiter-blocking',
      'csharp.async.getawaiter-blocking',
    );
    expect(result.passed, result.reason).toBe(true);
  });
});

describe('csharp.async.discard-assignment', () => {
  it('flags `_ =` at start of statement; ignores await', async () => {
    const result = await expectRuleOnFixture(
      discardAssignmentRule,
      'csharp.async.discard-assignment',
      'csharp.async.discard-assignment',
    );
    expect(result.passed, result.reason).toBe(true);
  });
});

describe('csharp.async.configure-await', () => {
  it('flags `.ConfigureAwait(false)`; ignores bare await', async () => {
    const result = await expectRuleOnFixture(
      configureAwaitRule,
      'csharp.async.configure-await',
      'csharp.async.configure-await',
    );
    expect(result.passed, result.reason).toBe(true);
  });
});

describe('csharp.naming.private-field-underscore', () => {
  it('flags `_fieldName` private fields; ignores camelCase fields', async () => {
    const result = await expectRuleOnFixture(
      privateFieldUnderscoreRule,
      'csharp.naming.private-field-underscore',
      'csharp.naming.private-field-underscore',
    );
    expect(result.passed, result.reason).toBe(true);
  });
});

describe('csharp.http.bare-httpclient', () => {
  it('flags `new HttpClient()`; ignores IHttpClientFactory.CreateClient', async () => {
    const result = await expectRuleOnFixture(
      bareHttpClientRule,
      'csharp.http.bare-httpclient',
      'csharp.http.bare-httpclient',
    );
    expect(result.passed, result.reason).toBe(true);
  });
});
