## Context

`package`, `import`, `func main`. Same shape as Rust (#22) and Java
(#23).

## Current behaviour

No Go pattern helpers. No Go examples.

## Expected behaviour

- `patterns.goPackageDecl()`      — `package <name>`
- `patterns.goImport()`          — `import "..."`
- `patterns.goFuncMain()`        — `func main()`
- `examples/go/go-no-fmt-print.lint.ts` (if useful)
- `assets/llm/examples/go/` companion files

## Acceptance criteria

- [ ] 3 Go helpers
- [ ] 2 Go example rules
- [ ] `assets/llm/examples/go/`
- [ ] Test: `test/patterns-go.test.ts`

## References

- src/patterns/index.ts
- Plan: Phase 10
