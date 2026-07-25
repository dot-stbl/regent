/**
 * Example AST rule — EF Core `builder.Property(<string-literal>)` is a magic
 * string and bypasses the lambda selector that gives the property name from
 * the entity itself. Use the lambda form `builder.Property(c => c.Id)` so
 * refactors rename the column for free.
 *
 * Mirrors `ef-core.md#no-magic-property`. This is the canonical use of
 * `defineAstRule`: the regex form cannot reliably distinguish
 * `builder.Property("Name")` (bad — magic string) from
 * `builder.HasColumnName("name")` (required, idiomatic EF) because both are
 * `<receiver>.<method>("<string>")` over text. AST sees the receiver method
 * name and the argument's `kind` and matches only the bad shape.
 *
 * Browse all C# examples via `regent llm examples csharp`. Copy this rule
 * via `regent example copy csharp csharp.ef.magic-property`.
 */
import { defineAstRule } from '@dot-stbl/regent';

export default defineAstRule({
  id: 'csharp.ef.magic-property',
  language: 'csharp',
  severity: 'warning',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: 'magic-string property reference — use a lambda selector',
  source: 'ef-core.md#no-magic-property',
  rationale:
    '`builder.Property(c => c.Id)` derives the property name from the entity, so a rename propagates automatically. The string-arg form `builder.Property("Name")` is a magic string: column and property can drift apart silently, the rename tool cannot find it, and the regex rule that used to flag it false-positived 223× on the idiomatic `HasColumnName("id")` calls.',
  ast: {
    rule: { pattern: '$OBJ.Property($ARG)' },
    constraints: { ARG: { has: { kind: 'string_literal' } } },
  },
});
