## Context

Phase 15 mentioned but didn't do. `src/core/` modules currently
have brief top-of-file comments but no method-level docs. Add
`/** ... */` blocks to public APIs (FileScanner, DagUtils, Cache,
etc.) so they show up in IDE hover and JSDoc output.

## Current behaviour

`src/core/cache.ts` has a module-level docblock. Functions like
`DiskCache.get/set` don't have `/** docs */` blocks — IDE hover shows
only the type signature.

## Expected behaviour

Every public class + public method in `src/core/` has a `/** */`
block describing:
- purpose (1 line)
- `@param` for each parameter
- `@returns` for return type
- `@throws` for known exceptions

## Acceptance criteria

- [ ] `src/core/cache.ts`: every public method has `/** */`
- [ ] `src/core/dag.ts`: ditto
- [ ] `src/core/diff.ts`: ditto
- [ ] `src/core/benchmark.ts`: ditto
- [ ] `src/core/scanner.ts`: ditto
- [ ] `src/core/scanner-matcher.ts`: ditto
- [ ] `src/core/scanner-defaults.ts`: ditto
- [ ] `bun run build` produces `dist/` with the docs (tsc preserves
      JSDoc in `.d.ts`)

## References

- src/core/* (all files)
- Plan: Phase 15
