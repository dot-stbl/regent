/**
 * L0: AST engine — proves ast-grep (via @ast-grep/napi + @ast-grep/lang-csharp)
 * parses code and matches structurally, so the `ef-magic-property` rule flags
 * only the real anti-pattern (`string` arg to `.Property()`) and ignores the
 * idiomatic `.HasColumnName("id")` that the old regex rule false-flagged 223×.
 */

import { describe, expect, it } from 'vitest';

import { scanAst } from '../src/ast/matcher.js';
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
  it('flags string-arg .Property, ignores lambda + .HasColumnName', async () => {
    const src = [
      'builder.Property(c => c.Id).HasColumnName("id");', // good — lambda + column name
      'builder.Property("Name").IsRequired();',          // bad — magic string
    ].join('\n');
    const matches = await scanAst(EF_MAGIC_PROPERTY.language, src, EF_MAGIC_PROPERTY.ast);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.text).toContain('"Name"');
    expect(matches[0]!.startLine).toBe(1); // 0-based → the second line
    expect(matches[0]!.startColumn).toBe(0);
    expect(matches[0]!.endColumn).toBeGreaterThan(matches[0]!.startColumn); // precise span
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
