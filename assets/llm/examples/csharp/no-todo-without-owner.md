# csharp.no-todo-without-owner

`// TODO` / `// FIXME` without a parenthesised ticket reference. Use
this as a template for any "annotation needs context" rule with
tri-state review.

## Code

```ts
// examples/csharp/no-todo-without-owner.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'csharp.no-todo-without-owner',
  severity: 'warning',
  pattern: patterns.todoComment().toRegex(),
  excludeWhen: patterns.ticketReference().toRegex(),
  globs: ['**/*.cs'],
  excludePaths: ['@generated'],
  message: 'TODO / FIXME without a ticket reference',
  review: {
    enabled: true,
    exitBehavior: 'unreviewed-fails',
    guidance:
      'Add a ticket reference like TODO(ANL-200) or accept with reason.',
  },
});
```

## When to apply

- House rule: every TODO needs an owner.
- The `review` block makes findings **pending** (not violations)
  until `regent accept` is called with a reason.
- Without `unreviewed-fails`, the rule wouldn't fail CI; with it,
  the team is forced to either fix or document.

## Testing

- `bad.cs` has `// TODO follow-up` — fires (pending).
- `good.cs` has `// TODO(ANL-200): follow-up` — does not fire.
