# rust.unsafe-block

`unsafe { ... }` blocks in non-test code.

Rust permits `unsafe`, but every site should be justified. Add a
`// unsafe-allow: <reason>` comment on the line above, or extract
behind a documented safe wrapper.

## Why

Rust's safety story depends on the small, auditable surface of
`unsafe`. Undocumented `unsafe` blocks propagate that surface
uncontrolled: a future refactor can shift the invariant under the
unsafe, leaving the original reasoning invalid. A short comment
binds the unsafe block to its invariant at the call site.

## Pattern

```regex
\bunsafe\s*\{
```

Excludes when the line above the match is `// unsafe-allow: ...`
(comment-prefix exemption). The comment must be on the immediately
preceding line (no blank line between).

Excludes paths: `**/tests/**`, `**/benches/**`, `**/examples/**`.
Unsafe in test code is fine — the safety argument is local to the
test.

## Authoring

When you need a real `unsafe`, put the `// unsafe-allow: <reason>`
comment on the SAME line as the `unsafe` keyword:

```rust
unsafe { // unsafe-allow: zero-init via set_len; len == cap == initialised.
    std::ptr::write_bytes(buf.as_mut_ptr(), 0, len);
    buf.set_len(len);
}
```

If the unsafe block is too complex for one-line justification, wrap
it in a private helper and link the helper from the call site.