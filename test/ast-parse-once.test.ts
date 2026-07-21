/**
 * L1: parse-once optimization — multiple ast rules of the same language on one
 * file must all fire (the runner parses the file once per language, then runs
 * every rule of that language over the shared tree).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runRules } from '../src/runner.js';
import type { CompiledAstRule } from '../src/kinds/ast.js';

const DIR = join(tmpdir(), `regent-parse-once-${Date.now()}`);

function csRule(id: string, ast: CompiledAstRule['spec']['ast']): CompiledAstRule {
  return {
    spec: { id, language: 'csharp', severity: 'warning', message: id, globs: ['**/*.cs'], ast },
    source: '<test>',
    origin: { kind: 'repo', path: DIR },
  };
}

beforeAll(() => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'M.cs'), 'void C(ModelBuilder b){ b.Property("Name"); Thread.Sleep(100); }\n');
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('runner: multiple ast rules, same language, one file', () => {
  it('runs every rule of a language over a single parse (both fire)', async () => {
    const rules = [
      csRule('csharp.ef.magic-property', {
        rule: { pattern: '$O.Property($A)' }, constraints: { A: { has: { kind: 'string_literal' } } },
      }),
      csRule('csharp.di.thread-sleep', { rule: { pattern: '$O.Sleep($A)' } }),
    ];
    const result = await runRules(
      [],
      { cwd: DIR, includeGlobs: ['**/*.cs'], excludeGlobs: [], changedOnly: false, diffBase: 'HEAD' },
      { astRules: rules },
    );
    const ids = result.findings.map((f) => f.ruleId).sort();
    expect(ids).toEqual(['csharp.di.thread-sleep', 'csharp.ef.magic-property']);
  });
});
