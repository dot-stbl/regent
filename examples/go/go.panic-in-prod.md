# go.panic-in-prod

`panic(` outside `main.go` and tests.

## Why

A panicking handler or shared utility turns upstream bugs into
whole-service outages — the runtime has no way to recover a
panicking goroutine, and the process exits with a stack trace.
Returning `error` lets the caller log, retry, or convert to a 5xx
without a process restart.

## Pattern

```regex
\bpanic\s*\(
```

Excludes paths: `**/main.go`, `**/*_test.go`, `**/testdata/**`,
`**/example/**`, `**/examples/**`. `main.go` is the canonical place
for a startup-failure panic; examples are short-lived demos.

## Authoring

Replace with `error` return:

```go
func Lookup(id string) (*Order, error) {
    row := db.Query(id)
    if row == nil {
        return nil, errors.New("order not found")
    }
    return row, nil
}
```

Reserve `panic` for genuinely unrecoverable programmer errors
(nil dereference, impossible branch in a switch, etc.) — and even
there, prefer `log.Fatal` in `main` and explicit error in libraries.