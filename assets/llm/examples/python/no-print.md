# python.no-print

`print(...)` in production Python. Use as a template for any
"banned-stdlib-call" rule.

## Code

```ts
// examples/python/no-print.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'python.no-print',
  severity: 'suggestion',
  pattern: '^\\s*print\\s*\\(',
  globs: ['**/*.py'],
  excludePaths: [
    '@generated',
    '**/tests/**',
    '**/test_*.py',
    '**/*_test.py',
    '**/conftest.py',
    '**/migrations/**',
    '**/scripts/**',
  ],
  message: '`print(...)` left in production code — use a logger.',
});
```

## When to apply

- Production code should use the `logging` module.
- Tests, scripts, and migrations are exempt (one-off use, not app
  code; data migrations legitimately print progress).
- Severity is `suggestion` (CI passes) — print in production is
  rarely a hard error, just a code smell.

## Testing

- `bad.py` has `print('hello')` at module level — fires.
- `good.py` uses `logger.info('hello')` — does not fire.
- `test_foo.py` has `print('debug')` — does not fire.
