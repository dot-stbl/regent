# typescript.no-throw-any

`any` as a TypeScript type annotation. Use as a template for any
"banned type" rule.

## Code

```ts
// examples/typescript/no-throw-any.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'typescript.no-any',
  severity: 'warning',
  pattern: patterns.tsAnyType().toRegex(),
  globs: ['**/*.ts', '**/*.tsx'],
  excludePaths: ['@generated', '@node-modules'],
  message: '`any` type is banned — use a specific type or `unknown`.',
});
```

## Variants

- `: any` — annotation (`const x: any = ...`)
- `<any>` — generic argument (`foo<any>()`)
- `as any` — cast (`(x as any) = ...`)

All three are covered by `patterns.tsAnyType()`.

## When to apply

- Strict TS project with `strict: true`. Any is a code smell.
- Pair with `no-console` for a frontend house-style set.

## Testing

- `bad.ts` has `: any`, `<any>`, `as any` — fires.
- `good.ts` uses `unknown` and explicit types — does not fire.
