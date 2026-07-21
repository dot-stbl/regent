/**
 * L1: AST rule-file discovery — an `ast` rule authored as a `.lint.ts` file
 * (like those in ~/.agents/rules) is picked up into `LoaderRuleSet.astRules`,
 * and `defineAstRule` is exported from the public package surface.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadRules } from '../src/loader.js';
import { defineAstRule } from '../src/index.js';

const DIR = join(tmpdir(), `regent-ast-discovery-${Date.now()}`);
const RULES = join(DIR, 'tools', 'audit', 'rules');

beforeAll(() => {
  mkdirSync(RULES, { recursive: true });
  writeFileSync(
    join(RULES, 'csharp.ef.magic-property.lint.ts'),
    `export default {
  id: 'test.ef.magic-property',
  language: 'csharp',
  severity: 'warning',
  message: 'magic-string property reference',
  globs: ['**/*.cs'],
  ast: { rule: { pattern: '$O.Property($A)' }, constraints: { A: { has: { kind: 'string_literal' } } } },
};`,
  );
  // A regex rule alongside — must NOT leak into astRules.
  writeFileSync(
    join(RULES, 'csharp.no-region.lint.ts'),
    `export default {
  id: 'test.no-region',
  severity: 'error',
  pattern: '#region',
  globs: ['**/*.cs'],
  message: 'no #region',
};`,
  );
});

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('ast rule-file discovery', () => {
  it('picks up ast .lint.ts files into astRules (and keeps regex in rules)', async () => {
    const loaded = await loadRules({ repoRoot: DIR, skipLocal: true });
    expect(loaded.astRules.map((r) => r.spec.id)).toContain('test.ef.magic-property');
    expect(loaded.astRules.find((r) => r.spec.id === 'test.ef.magic-property')?.spec.language).toBe('csharp');
    // The regex rule went to `rules`, not `astRules`.
    expect(loaded.astRules.map((r) => r.spec.id)).not.toContain('test.no-region');
    expect(loaded.rules.map((r) => r.spec.id)).toContain('test.no-region');
  });

  it('exports defineAstRule from the public surface', () => {
    const rule = defineAstRule({
      id: 'x.y', language: 'csharp', severity: 'warning', message: 'm',
      globs: ['**/*.cs'], ast: { rule: { pattern: '$A' } },
    });
    expect(Object.isFrozen(rule)).toBe(true);
    expect(rule.id).toBe('x.y');
  });
});
