/**
 * L1: AST review-mode plumbing (issue #104) — the AST branch of
 * `scanFileContent` mirrors the detect-path tri-state status
 * assignment. AST rules with `review.enabled` produce `pending`
 * findings (or `accepted` when the accept-list matches); non-review
 * AST rules keep the pre-104 `violation` behaviour.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runRules } from '../src/runner.js';
import type { AcceptEntry } from '../src/types.js';
import type { CompiledAstRule } from '../src/kinds/ast.js';

const DIR = join(tmpdir(), `regent-ast-review-${Date.now()}`);

const AST_PATTERN = {
  rule: { pattern: '$OBJ.Property($ARG)' },
  constraints: { ARG: { has: { kind: 'string_literal' } } },
};

const REVIEW_RULE: CompiledAstRule = {
  spec: {
    id: 'csharp.ef.magic-property',
    language: 'csharp',
    severity: 'warning',
    message: 'magic-string property reference',
    globs: ['**/*.cs'],
    review: { enabled: true, exitBehavior: 'unreviewed-fails', guidance: 'check magic-string' },
    ast: AST_PATTERN,
  },
  source: '<test>',
  origin: { kind: 'repo', path: DIR },
};

const PLAIN_RULE: CompiledAstRule = {
  spec: {
    id: 'csharp.ef.magic-property-plain',
    language: 'csharp',
    severity: 'warning',
    message: 'magic-string property reference',
    globs: ['**/*.cs'],
    ast: AST_PATTERN,
  },
  source: '<test>',
  origin: { kind: 'repo', path: DIR },
};

beforeAll(() => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    join(DIR, 'Model.cs'),
    [
      'public class M {',
      '  void C(ModelBuilder b) {',
      '    b.Property(x => x.Id).HasColumnName("id");', // good
      '    b.Property("Name").IsRequired();',           // bad (0-based line 3)
      '    b.Property("Other").IsRequired();',          // bad (0-based line 4)
      '  }',
      '}',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

const scope = { cwd: DIR, includeGlobs: ['**/*.cs'], excludeGlobs: [], changedOnly: false, diffBase: 'HEAD' };

describe('runner: AST rule tri-state review (#104)', () => {
  it('review-enabled rule produces status=pending with review metadata', async () => {
    const result = await runRules([], scope, { astRules: [REVIEW_RULE] });
    const ast = result.findings.filter((f) => f.ruleId === REVIEW_RULE.spec.id);
    expect(ast).toHaveLength(2);
    for (const f of ast) {
      expect(f.status).toBe('pending');
      expect(f.review?.guidance).toBe('check magic-string');
      expect(f.review?.exitBehavior).toBe('unreviewed-fails');
    }
  });

  it('per-line accept-list entry downgrades matching AST finding to status=accepted', async () => {
    const accepts: AcceptEntry[] = [
      { ruleId: REVIEW_RULE.spec.id, path: join(DIR, 'Model.cs'), line: 4, reason: 'tracked' },
    ];
    const result = await runRules([], scope, { astRules: [REVIEW_RULE], acceptList: accepts });
    const ast = result.findings.filter((f) => f.ruleId === REVIEW_RULE.spec.id);
    expect(ast).toHaveLength(2);
    expect(ast.find((f) => f.match.startLine === 3)?.status).toBe('accepted');
    expect(ast.find((f) => f.match.startLine === 3)?.acceptedReason).toBe('tracked');
    expect(ast.find((f) => f.match.startLine === 4)?.status).toBe('pending');
  });

  it('whole-file accept-list entry silences every AST review finding', async () => {
    const accepts: AcceptEntry[] = [
      { ruleId: REVIEW_RULE.spec.id, path: join(DIR, 'Model.cs'), reason: 'legacy' },
    ];
    const result = await runRules([], scope, { astRules: [REVIEW_RULE], acceptList: accepts });
    for (const f of result.findings) {
      expect(f.status).toBe('accepted');
    }
  });
});

describe('runner: non-review AST rule backwards-compat (#104)', () => {
  it('AST rule without review still produces status=violation', async () => {
    const result = await runRules([], scope, { astRules: [PLAIN_RULE] });
    expect(result.findings).toHaveLength(2);
    for (const f of result.findings) {
      expect(f.status).toBe('violation');
      expect(f.review).toBeUndefined();
      expect(f.acceptedReason).toBeUndefined();
    }
  });
});