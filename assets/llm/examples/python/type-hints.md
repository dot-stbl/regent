# python.type-hints

Public functions in `src/` should declare return types. Use as a
template for any Python convention rule.

## Code

```ts
// examples/python/type-hints.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'python.public-no-return-type',
  severity: 'warning',
  pattern: '^def\\s+[a-zA-Z_]\\w*\\s*\\([^)]*\\)\\s*->?\\s*(?!.*:)',  // heuristic
  globs: ['**/*.py'],
  excludePaths: ['@generated', '**/tests/**', '**/__init__.py'],
  message: 'public function missing return type annotation',
});
```

## Heuristic notes

Real type-annotation rules need AST inspection (mypy / ruff). The
above is a coarse pattern that catches "def foo(): ..." without
`->`. False-positive rate is high; pair with `review` to keep
findings as `pending` until manually triaged.

For real type-annotation enforcement, use ruff's `ANN` rules. The
regent example demonstrates the *shape* of a language-specific rule
even if production usage prefers a real linter.

## When to apply

- Lightweight CI nudge before adopting mypy/ruff.
- Or use this to **find** functions that need annotations, then
  accept each one as a tracking entry.

## Testing

- `bad.py` has `def foo():` — fires.
- `good.py` has `def foo() -> int:` — does not fire.
