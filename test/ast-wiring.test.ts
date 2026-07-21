/**
 * L1/L3: AST rule kind wired through runner + loader (PR 2 of #43).
 *
 * Proves `regent` runs `ast`-kind rules end-to-end: the runner scans a file
 * with ast-grep and emits precise findings, and the loader surfaces
 * `config.rules.ast[]` into `LoaderRuleSet.astRules`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runRules } from '../src/runner.js';
import { loadRules } from '../src/loader.js';
import type { CompiledAstRule } from '../src/kinds/ast.js';

const DIR = join(tmpdir(), `regent-ast-wiring-${Date.now()}`);

const AST_RULE: CompiledAstRule = {
  spec: {
    id: 'csharp.ef.magic-property',
    language: 'csharp',
    severity: 'warning',
    message: 'magic-string property reference — use a lambda selector',
    globs: ['**/*.cs'],
    ast: {
      rule: { pattern: '$OBJ.Property($ARG)' },
      constraints: { ARG: { has: { kind: 'string_literal' } } },
    },
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
      '    b.Property("Name").IsRequired();',           // bad
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  // Config declaring the same rule under rules.ast[] — proves loader wiring.
  writeFileSync(
    join(DIR, '.regentrc.js'),
    `export default {
  rules: {
    ast: [
      {
        id: 'csharp.ef.magic-property',
        language: 'csharp',
        severity: 'warning',
        message: 'magic-string property reference',
        globs: ['**/*.cs'],
        ast: { rule: { pattern: '$OBJ.Property($ARG)' }, constraints: { ARG: { has: { kind: 'string_literal' } } } },
      },
    ],
  },
};`,
  );
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe('runner: ast rules', () => {
  it('flags the string-arg .Property with a precise span, ignores the lambda form', async () => {
    const result = await runRules(
      [],
      { cwd: DIR, includeGlobs: ['**/*.cs'], excludeGlobs: [], changedOnly: false, diffBase: 'HEAD' },
      { astRules: [AST_RULE] },
    );
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.ruleId).toBe('csharp.ef.magic-property');
    expect(f.status).toBe('violation');
    expect(f.match.startLine).toBe(3); // 0-based → the `b.Property("Name")` line
    expect(f.match.startColumn).toBeGreaterThan(0); // precise, mid-line
    expect(f.match.matchText).toContain('Property("Name")');
  });
});

describe('loader: config.rules.ast → astRules', () => {
  it('surfaces inline AST rules into LoaderRuleSet.astRules', async () => {
    const loaded = await loadRules({ repoRoot: DIR, skipLocal: true });
    const ids = loaded.astRules.map((r) => r.spec.id);
    expect(ids).toContain('csharp.ef.magic-property');
    expect(loaded.astRules[0]!.spec.language).toBe('csharp');
  });
});
