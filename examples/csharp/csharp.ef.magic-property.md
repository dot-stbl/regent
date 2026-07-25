# `csharp.ef.magic-property` — AST example

The first shipped example that uses [`defineAstRule`](../../src/kinds/ast.ts) instead of the regex `defineRule` surface.

## What the rule flags

```csharp
builder.Property("Name")   // ❌ magic-string property reference
```

Calls to `.Property(...)` whose argument is a string literal. The string
form detaches the EF Core mapping from the entity's C# property name — a
rename on `OrderEntity.Name` leaves `builder.Property("Name")` pointing at
a column that no longer corresponds to anything. The runtime reads the
wrong column silently; the compiler cannot help.

## What the rule accepts

```csharp
builder.Property(c => c.Name)                  // ✅ lambda selector
builder.Property(c => c.Name).HasColumnName("name")  // ✅ + idiomatic column name
```

The lambda form is the only one that keeps the link honest. `.HasColumnName("name")`
is *required* alongside the lambda — it pins the on-disk column name across
renames — and the AST rule does not flag it.

## Why AST, not regex

The two shapes share the same text:

| Code | Regex sees | AST sees |
|---|---|---|
| `builder.Property("Name")` | match | match (receiver is `Property`, arg is `string_literal`) |
| `builder.HasColumnName("name")` | match | no match (receiver is `HasColumnName`) |

A regex rule that targets `<id>.Property\("<literal>\)"` either misses
`c => c.Name` (false negative) or false-positives `HasColumnName("name")`
every time — the regex version of this rule used to fire 223× across a
mid-sized codebase. AST distinguishes the two by the receiver method name
and the argument's `kind`.

## Pattern shape

```ts
defineAstRule({
  id: 'csharp.ef.magic-property',
  language: 'csharp',
  severity: 'warning',
  globs: ['**/*.cs'],
  ast: {
    rule: { pattern: '$OBJ.Property($ARG)' },          // match any `.Property(x)` call
    constraints: { ARG: { has: { kind: 'string_literal' } } },  // narrow to string-arg form
  },
});
```

Two pieces:

- `rule.pattern` — the structural pattern. `$OBJ` and `$ARG` are
  metavariables; bind them to anything.
- `constraints` — narrow the metavariables. Here we say *only fire when
  `$ARG` is a `string_literal` node*, which excludes lambda selectors,
  method calls, and identifiers.

The constraint is what makes this rule tractable. Without it, every
`.Property(x)` call would fire and we'd be back to "fire on the
property accessor itself" — useless.

## Copying this rule

```sh
regent example copy csharp csharp.ef.magic-property
```

Writes the rule into your project's `tools/audit/rules/` as a real rule
file you can extend or override.

## Fixtures

`__fixtures__/csharp.ef.magic-property/bad.cs` — three magic-string
`.Property("...")` calls; the shipped-example harness asserts the AST
runner produces ≥ 1 finding against it.

`__fixtures__/csharp.ef.magic-property/good.cs` — the same three
properties re-written as `.Property(c => c.X)` with `.HasColumnName(...)`
chained on; the harness asserts zero findings.
