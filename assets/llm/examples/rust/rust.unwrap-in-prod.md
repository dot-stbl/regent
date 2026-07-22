# rust.unwrap-in-prod

`.unwrap()` in production code (`src/`) is a smell — it panics on
`Err` / `None`. Production paths that panic translate upstream
failures into 500s at the boundary; every `.unwrap()` is a potential
DoS vector when the upstream is hostile or flaky.

## Code

```ts
// examples/rust/rust.unwrap-in-prod.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'rust.unwrap-in-prod',
  severity: 'warning',
  pattern: patterns.rustUnwrap().toRegex(),
  excludeWhen: '^\\s*//',
  excludePaths: [
    '**/tests/**',
    '**/benches/**',
    '**/examples/**',
    '**/test_*.rs',
    '**/*_test.rs',
  ],
  globs: ['**/*.rs'],
  message:
    '`.unwrap()` in production code panics on `None` / `Err`. Prefer ' +
    '`?` propagation, `unwrap_or`, or explicit error handling.',
});
```

## When to apply

- Production source (`src/`) is the default.
- Exempt: `tests/`, `benches/`, `examples/`, `test_*.rs`, `*_test.rs`
  — tests benefit from `.unwrap()` because a test failure should be
  loud and immediate.
- Pairs with a manual review for cases where `.unwrap()` is genuinely
  the right shape (initialization in `OnceCell`/`OnceLock`, invariants
  the type system can carry but a quick script can't).

## Pattern note

`patterns.rustUnwrap()` matches the call form `.unwrap(`. It does
NOT fire on `.unwrap_or(...)` / `.unwrap_or_else(...)` / `.expect(...)`,
which are the appropriate fallbacks.

## Testing

`examples/rust/__fixtures__/rust.unwrap-in-prod/{bad,good}.rs`
(when present):
- `bad.rs`: `let raw = std::fs::read_to_string(path).unwrap();` — fires.
- `good.rs`: `let raw = std::fs::read_to_string(path)?;` — does not.
- `good.rs`: `let raw = std::fs::read_to_string(path).unwrap_or_default();`
  — does not.
