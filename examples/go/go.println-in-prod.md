# go.println-in-prod

`fmt.Print*` in production code.

## Why

Stdout writes bypass the logger pipeline. In a server context this
means operators see unstructured lines while structured logs land in
the aggregator. There's no level, no sink, no JSON output.

## Pattern

```regex
\bfmt\.(Print|Println|Printf|Println)\s*\(
```

Excludes paths: `**/*_test.go`, `**/testdata/**`.

## Authoring

Replace with `log/slog` (Go 1.21+), `logrus`, or `zap`:

```go
import "log/slog"

slog.Info("shipping order", "order_id", orderID)
```

For errors:

```go
slog.Error("charge failed", "err", err, "order_id", orderID)
```

If you genuinely need a debug line in production, leave a
// FIXME with the issue ticket.