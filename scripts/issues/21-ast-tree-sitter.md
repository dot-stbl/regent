## Context

v0.5+ in plan. Currently regent is per-line only. tree-sitter
gives proper multi-line / cross-line matching — necessary for
"this function is too long" or "this class has too many
methods". Phase 3 plan mentioned tree-sitter as a future option.

## Current behaviour

Multi-line patterns not supported. Agent must compose per-line
patterns + `excludeWhen` for context. Some checks are infeasible
(this rule needs a real AST).

## Expected behaviour

- Rule spec can declare `kind: 'ast'` (new) — the runner dispatches
  via tree-sitter for the rule's globs
- The rule's pattern becomes an AST query (tree-sitter syntax)
- Match results include node ranges (startLine, endLine, startColumn,
  endColumn, nodeType, capturedFields)
- Detect-only in v0.3; fix/transform in v0.4+

## Acceptance criteria

- [ ] tree-sitter integration via web-tree-sitter (WASM build)
- [ ] at least one tree-sitter parser shipped (TypeScript or C#)
- [ ] One example AST rule shipped
- [ ] Test: `test/ast-rule.test.ts`

## References

- Plan: Phase 3 (deferred to v0.5+)
