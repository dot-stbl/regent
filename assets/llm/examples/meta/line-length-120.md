# meta.line-length-120

Lines over 120 characters. Use as a template for any "soft
nudge" rule with tri-state review.

## Code

```ts
// examples/meta/line-length-120.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'meta.line-length-120',
  severity: 'suggestion',
  pattern: '^.{121,}$',
  globs: ['**/*.ts', '**/*.cs', '**/*.py', '**/*.go', '**/*.rs'],
  excludePaths: ['@generated', '@node-modules', '@build-output'],
  message: 'line exceeds 120 characters',
  review: {
    enabled: true,
    exitBehavior: 'no-fail',
    guidance:
      '120 is a soft cap. Long lines are sometimes OK (URLs, regex); accept with reason.',
  },
});
```

## Why `severity: suggestion` + `exitBehavior: 'no-fail'`

Long-line rules are noisy and produce many false positives. They
should never fail CI on their own. `suggestion` is informational;
`exitBehavior: 'no-fail'` (default for review rules) means the
team sees the findings in `regent review` but can ship without
explicitly triaging each.

## When to apply

- Soft cap for code review hygiene.
- Pair with a `regent fix` for line-wrapping if the team has a
  formatter (prettier, black). Detect-only is fine for code review.

## Testing

- `bad.ts` has `const x = 'a'.repeat(150);` (151 chars) — fires.
- `good.ts` has all lines ≤ 120 chars — does not fire.
