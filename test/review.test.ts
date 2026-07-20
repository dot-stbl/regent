/**
 * L0: tri-state review — runner classifies findings as
 * `pending` / `accepted` / `violation` based on review-mode rules + accept-list.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { defineRule } from '../src/define-rule.js';
import { runRules } from '../src/runner.js';
import type { AcceptEntry, RuleSpec } from '../src/types.js';

const TEST_DIR = join(tmpdir(), `regent-tri-${Date.now()}`);

beforeAll(() => {
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
  writeFileSync(
    join(TEST_DIR, 'src', 'review.cs'),
    [
      '// TODO follow-up',
      '// FIXME bug',
      '// TODO(ANL-200) tracked',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(TEST_DIR, 'src', 'strict.cs'),
    [
      '#region Bad',
      'public class A {}',
      '#endregion',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

const TODO_RULE: RuleSpec = defineRule({
  id: 'csharp.no-todo-without-owner',
  severity: 'warning',
  pattern: '//\\s*(TODO|FIXME)\\b',
  excludeWhen: '//\\s*(TODO|FIXME)\\s*\\(',
  globs: ['**/*.cs'],
  message: 'TODO без owner',
  review: {
    enabled: true,
    exitBehavior: 'unreviewed-fails',
    guidance: 'проверь owner/ticket',
  },
});

const STRICT_RULE: RuleSpec = defineRule({
  id: 'csharp.no-region-directive',
  severity: 'error',
  pattern: '^\\s*#region\\b',
  globs: ['**/*.cs'],
  message: '#region',
});

describe('tri-state review', () => {
  it('non-review rule produces status=violation', async () => {
    const result = await runRules([STRICT_RULE], {
      cwd: TEST_DIR,
      includeGlobs: ['**/*.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.status).toBe('violation');
    }
  });

  it('review rule produces status=pending when no accept entry', async () => {
    const result = await runRules([TODO_RULE], {
      cwd: TEST_DIR,
      includeGlobs: ['**/*.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    const todoFindings = result.findings.filter((f) => f.ruleId === 'csharp.no-todo-without-owner');
    expect(todoFindings.length).toBe(2);
    for (const f of todoFindings) {
      expect(f.status).toBe('pending');
      expect(f.review?.guidance).toBe('проверь owner/ticket');
      expect(f.review?.exitBehavior).toBe('unreviewed-fails');
    }
  });

  it('accept-list entry downgrades finding to status=accepted', async () => {
    const accepts: AcceptEntry[] = [
      {
        ruleId: 'csharp.no-todo-without-owner',
        path: join(TEST_DIR, 'src', 'review.cs'),
        line: 1,
        reason: 'tracking in ANL-200',
      },
    ];
    const result = await runRules([TODO_RULE], {
      cwd: TEST_DIR,
      includeGlobs: ['**/*.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    }, { acceptList: accepts });

    const line1 = result.findings.find((f) => f.match.startLine + 1 === 1);
    expect(line1?.status).toBe('accepted');
    expect(line1?.acceptedReason).toBe('tracking in ANL-200');

    // Line 2 (FIXME) is NOT accepted → still pending
    const line2 = result.findings.find((f) => f.match.startLine + 1 === 2);
    expect(line2?.status).toBe('pending');
  });

  it('whole-file accept-entry silences every line', async () => {
    const accepts: AcceptEntry[] = [
      {
        ruleId: 'csharp.no-todo-without-owner',
        path: join(TEST_DIR, 'src', 'review.cs'),
        reason: 'legacy file under migration',
      },
    ];
    const result = await runRules([TODO_RULE], {
      cwd: TEST_DIR,
      includeGlobs: ['**/*.cs'],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    }, { acceptList: accepts });

    for (const f of result.findings) {
      expect(f.status).toBe('accepted');
    }
  });
});
