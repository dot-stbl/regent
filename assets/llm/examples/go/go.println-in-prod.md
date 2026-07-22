# go.println-in-prod

`fmt.Println` / `fmt.Printf` / `fmt.Printf` in production code is
debug noise. Stdout bypasses the logger pipeline — no level, no
sink configuration, no structured fields. Production code should
use `slog` (stdlib since 1.21), `logrus`, `zap`, or similar.

## Code

```ts
// examples/go/go.println-in-prod.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'go.println-in-prod',
  severity: 'warning',
  pattern: '\\bfmt\\.(Print|Println|Printf|Println)\\s*\\(',
  globs: ['**/*.go'],
  excludePaths: ['**/*_test.go', '**/testdata/**'],
  message:
    '`fmt.Print*` in production code. Use a structured logger ' +
    '(`slog`, `logrus`, `zap`) so output is routable + filterable.',
});
```

## When to apply

- Production code shipped as a library or service.
- Exempt: `*_test.go` and `testdata/` — test failure diagnostics
  often use `fmt.Println` deliberately.

## Pattern note

Note the rule's pattern lists `Println` twice — harmless for the
regex engine but worth flagging in any future helper. When a
`patterns.goPrintln()` helper ships it should ship with a
deduplicated alternative set.

## Testing

`examples/go/__fixtures__/go.println-in-prod/{bad,good}.go`
(when present): `bad.go` calls `fmt.Println("hi")` and fires;
`good.go` calls `slog.Info("hi")` and does not fire.
