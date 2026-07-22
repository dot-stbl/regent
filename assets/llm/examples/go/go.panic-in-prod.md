# go.panic-in-prod

`panic(...)` in a library or handler kills the process. In Go,
returning an `error` and letting the caller decide is the idiomatic
shape — reserve `panic` for genuinely unrecoverable programmer
errors (e.g. unreachable codepaths, contract violations).

## Code

```ts
// examples/go/go.panic-in-prod.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'go.panic-in-prod',
  severity: 'warning',
  pattern: patterns.goPanic().toRegex(),
  globs: ['**/*.go'],
  excludePaths: [
    '**/main.go',
    '**/*_test.go',
    '**/testdata/**',
    '**/example/**',
    '**/examples/**',
  ],
  message:
    '`panic(` in a library or handler kills the process. Return ' +
    '`error` and let callers handle it; reserve `panic` for ' +
    'genuinely unrecoverable programmer errors.',
});
```

## When to apply

- Library packages, shared helpers, HTTP handlers, gRPC services.
- Exempt: `main.go`, `*_test.go`, `testdata/`, and any package
  whose docs position it as an example fixture — those typically
  use `panic` deliberately to surface misuse.

## Pattern note

`patterns.goPanic()` matches `panic(` (call form only — does not
fire on `panic("...")` in a const-declaration context that doesn't
exist in Go, but stays narrow to keep false positives low).

## Testing

`examples/go/__fixtures__/go.panic-in-prod/{bad,good}.go`
(when present): `bad.go` calls `panic("oops")` from a library
function and fires; `good.go` returns `fmt.Errorf(...)`.
