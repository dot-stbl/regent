# csharp.no-region-directive

`#region` directives are banned in C# source. Use this as a template
for any C# "structural ban" rule.

## Code

```ts
// examples/csharp/no-region-directive.lint.ts
import { defineDetectRule } from '../../src/define-rule.js';

export default defineDetectRule({
  id: 'csharp.no-region-directive',
  severity: 'error',
  pattern: '^\\s*#region\\b',
  globs: ['**/*.cs'],
  excludePaths: ['@generated', '**/Migrations/**'],
  message: '#region directives are banned (code-shape.md §10).',
  rationale:
    'Files > 300 lines are a refactor signal — extract, do not collapse.',
});
```

## When to apply

- Strict control over class decomposition.
- `#region`/`#endregion` hide structure from outline, encourage
  bloat, add noise to diffs.
- Pair with `examples/csharp.no-private-methods.lint.ts` for a
  full house-style enforcement suite.

## Testing

`examples/csharp/__fixtures__/no-region-directive/{bad,good}.cs`:
- `bad.cs` contains `#region` and `#endregion` — fires.
- `good.cs` is a normal C# class — does not fire.
