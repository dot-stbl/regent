# rust.unwrap-in-prod

`.unwrap()` in production code (`src/`) is a smell. Reserve `.unwrap()`
for tests.

## Why

`Result::unwrap` and `Option::unwrap` panic on `Err` / `None`.
Production paths that panic translate upstream failures into 500s at
the boundary — every `.unwrap()` is a potential DoS vector when the
upstream is hostile or flaky.

Tests benefit from `.unwrap()` because a test failure should be
loud and immediate; production code benefits from explicit error
handling or `?` propagation.

## Pattern

```regex
\.unwrap\s*\(
```

Excludes paths: `**/tests/**`, `**/benches/**`, `**/examples/**`,
`**/test_*.rs`, `**/*_test.rs`.

## Authoring

Replace with `?` propagation when the error is recoverable:

```rust
let raw = std::fs::read_to_string(path)?;     // instead of .unwrap()
```

Replace with `.unwrap_or(default)` / `.unwrap_or_else(|| ...)` when a
fallback is acceptable:

```rust
let count = cache.get(key).unwrap_or(0);      // default-on-miss
let value = cache.get(key).unwrap_or_else(|| compute_default());
```

Replace with explicit `match` when the error path needs handling:

```rust
let parsed = match serde_json::from_str(&raw) {
    Ok(v) => v,
    Err(e) => return Err(Error::Parse(e)),
};
```