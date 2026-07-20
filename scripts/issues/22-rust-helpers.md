## Context

Plan called for: `pub fn`, `use crate::`, `unsafe`, `unwrap()`. Add
these to `src/patterns/index.ts` alongside the existing 23 helpers;
ship `examples/rust/*.lint.ts` for each.

## Current behaviour

No Rust pattern helpers. No Rust examples. Agent writing a Rust
rule has to hand-roll RE2 patterns.

## Expected behaviour

- `patterns.rustPubFn()`         — `pub fn <name>(...)`
- `patterns.rustUseCrate()`       — `use crate::...`
- `patterns.rustUnsafe()`         — `unsafe { ... }`
- `patterns.rustUnwrap()`         — `.unwrap()` (often a smell)
- `examples/rust/rust-no-unwrap.lint.ts`
- `examples/rust/rust-no-unsafe.lint.ts`
- Update `assets/llm/examples/` with companion `.md` files

## Acceptance criteria

- [ ] 4 Rust helpers added to patterns namespace
- [ ] 2+ Rust example rules shipped with fixtures
- [ ] `assets/llm/examples/rust/` index.md + per-rule .md files
- [ ] Test: `test/patterns-rust.test.ts`

## References

- src/patterns/index.ts (current 23 helpers)
- Plan: Phase 10 shipped examples
