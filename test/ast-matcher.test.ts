/**
 * L0: AST engine — proves ast-grep (via @ast-grep/napi + @ast-grep/lang-csharp)
 * parses code and matches structurally, so the `ef-magic-property` rule flags
 * only the real anti-pattern (`string` arg to `.Property()`) and ignores the
 * idiomatic `.HasColumnName("id")` that the old regex rule false-flagged 223×.
 */

import { describe, expect, it } from 'vitest';

import { matchRuleOnRoot, scanAst } from '../src/ast/matcher.js';
import { defineAstRule } from '../src/kinds/ast.js';

const EF_MAGIC_PROPERTY = defineAstRule({
  id: 'csharp.ef.magic-property',
  language: 'csharp',
  severity: 'warning',
  message: 'magic-string property reference — use a lambda selector',
  globs: ['**/*.cs'],
  ast: {
    rule: { pattern: '$OBJ.Property($ARG)' },
    constraints: { ARG: { has: { kind: 'string_literal' } } },
  },
});

describe('AST engine (ast-grep + csharp)', () => {
  it('returns metadata and a precise range for a multi-line AST node', async () => {
    const src = [
      'builder.Property(c => c.Id).HasColumnName("id");',
      'builder',
      '  .Property(',
      '    "Name"',
      '  )',
      '  .IsRequired();',
    ].join('\n');
    const matches = await scanAst(EF_MAGIC_PROPERTY.language, src, EF_MAGIC_PROPERTY.ast);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      startLine: 1,
      startColumn: 0,
      endLine: 4,
      nodeType: 'invocation_expression',
      captured: { OBJ: 'builder', ARG: '"Name"' },
    });
  });

  it('falls back to no captures when getMatch is unavailable', () => {
    const root = {
      findAll: () => [{
        range: () => ({ start: { line: 0, column: 0 }, end: { line: 0, column: 1 } }),
        text: () => 'x',
        kind: () => 'identifier',
      }],
    } as never;
    expect(matchRuleOnRoot(root, { rule: { pattern: '$X' } })[0]!.captured).toEqual({});
  });

  it('returns no matches for the correct lambda form (was a 223x false positive)', async () => {
    const src = [
      'builder.Property(c => c.Id).HasColumnName("id").HasColumnType("varchar(64)");',
      'builder.Property(c => c.OrgId).HasColumnName("org_id");',
    ].join('\n');
    const matches = await scanAst('csharp', src, EF_MAGIC_PROPERTY.ast);
    expect(matches).toHaveLength(0);
  });

  it('throws a clear error for a missing language pack', async () => {
    await expect(
      scanAst('nonexistent-lang', 'x', { rule: { pattern: '$X' } }),
    ).rejects.toThrow(/language pack/i);
  });
});
