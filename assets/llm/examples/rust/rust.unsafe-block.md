# rust.unsafe-block

`unsafe { ... }` blocks in non-test code. Rust permits `unsafe`, but
every site should be justified. Add a `// unsafe-allow: <reason>`
comment on the same line as the `unsafe` keyword, or extract behind a
documented safe wrapper.

## Code

```ts
// examples/rust/rust.unsafe-block.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'rust.unsafe-block',
  severity: 'warning',
  pattern: patterns.rustUnsafe().toRegex(),
  excludeWhen: '//\\s*unsafe-allow',
  excludePaths: ['**/tests/**', '**/benches/**', '**/examples/**'],
  globs: ['**/*.rs'],
  message:
    '`unsafe { ... }` block found. Add a `// unsafe-allow: <reason>` ' +
    'comment on the SAME line as the `unsafe` keyword, or extract ' +
    'behind a documented safe wrapper.',
});
```

## When to apply

- Production code (`src/`) is the default.
- Exempt: `tests/`, `benches/`, `examples/` (the safety argument
  is local to the test/example harness).
- Add an exclusion for the `unsafe-allow` comment via `excludeWhen`
  so documented sites don't fire.

## Pattern note

`patterns.rustUnsafe()` matches `unsafe` followed by `{` — line-scoped,
so the rule fires on every block opener. For a stricter rule (require
the justification on the *preceding* line) pair with a follow-up
review pass.

## Testing

`examples/rust/__fixtures__/rust.unsafe-block/{bad,good}.rs`
(when present): `bad.rs` has a bare `unsafe { ptr::write(...) }` and
fires; `good.rs` has `unsafe { // unsafe-allow: zero-init via set_len; ... }`
and does not.
