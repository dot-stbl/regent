## Context

`public class`, `System.out.println`, `@Override`. Same pattern as
Rust (#22) — add to patterns + ship `examples/java/`.

## Current behaviour

No Java pattern helpers. No Java examples.

## Expected behaviour

- `patterns.javaPublicClass()`    — `public class <name>`
- `patterns.javaSystemOut()`      — `System.out.println(...)`
- `patterns.javaOverride()`       — `@Override`
- `examples/java/java-no-sysout.lint.ts`
- `examples/java/java-no-public-class.lint.ts` (if useful)
- `assets/llm/examples/java/` companion files

## Acceptance criteria

- [ ] 3 Java helpers
- [ ] 2 Java example rules
- [ ] `assets/llm/examples/java/`
- [ ] Test: `test/patterns-java.test.ts`

## References

- src/patterns/index.ts
- Plan: Phase 10
