# csharp.async.configure-await

`.ConfigureAwait(false)` is banned in app code. Mirrors
`async-and-tasks.md#no-configureawait` in the global rule book; this
shipped example is the v1 fix-mode reference for the C# async
family of rules.

## Code

```ts
// examples/csharp/csharp.async.configure-await.lint.ts
import { defineRule } from '@dot-stbl/regent';

export default defineRule({
  id: 'csharp.async.configure-await',
  severity: 'error',
  pattern: '\\.ConfigureAwait\\s*\\(\\s*false\\s*\\)',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`.ConfigureAwait(false)` is banned in app code.',
  source: 'async-and-tasks.md#no-configureawait',
  rationale:
    'Adding `.ConfigureAwait(false)` in app code is a no-op in ASP.NET Core (no SynchronizationContext). Library code is exempt.',
  fix: { kind: 'replace', safety: 'safe', title: 'csharp.async.configure-await', template: '' },
});
```

## Fix shape

- **`kind`: `replace`** — declarative template, no function form.
- **`safety`: `safe`** — `regent fix` auto-applies; the rewrite is a
  mechanical delete of a no-op call. Library code is exempt (covered
  by `excludePaths` and by the per-rule rationale).
- **`template`: `''`** — empty template = delete the match. Captures
  are not used here.

## When to apply

- Strict control over async call shapes in app code.
- Pair with the broader `csharp.async.*` family (discard-assignment,
  getawaiter-blocking, result-blocking) for a full async house-style
  suite.

## Testing

`examples/csharp/__fixtures__/csharp.async.configure-await/{bad,good,fixed}.cs`:

- `bad.cs` — chain that ends with `.ConfigureAwait(false);` on its own
  line; rule fires.
- `good.cs` — the same chain collapsed onto a single line (the
  human-cleaned final shape); rule does not fire.
- `fixed.cs` — the literal `regent fix` output: the
  `.ConfigureAwait(false)` substring is gone, leaving an empty
  statement `;` on the line where the call used to sit. A single
  empty statement is legal C# but stylistically noisy; `good.cs`
  demonstrates the chain-on-one-line shape human editors typically
  aim for.

`fixed.cs` and `good.cs` legitimately differ — `fixed.cs` is the
literal mechanical output, `good.cs` is the human-cleaned final
shape. The shipped-examples test asserts `fixed.cs` equals engine
output, NOT that it equals `good.cs`.
