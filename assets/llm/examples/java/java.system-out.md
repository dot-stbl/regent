# java.system-out

`System.out.println` / `System.err.printf` in production code. Stdout
is debug noise — production paths should use a logger (SLF4J / Log4j /
JUL) so output is routed by level and correlation id.

## Code

```ts
// examples/java/java.system-out.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'java.system-out',
  severity: 'warning',
  pattern: patterns.javaSystemOut().toRegex(),
  excludePaths: ['**/test/**', '**/tests/**'],
  globs: ['**/*.java'],
  message:
    '`System.out` / `System.err` in production code. Use a logger ' +
    '(SLF4J / Log4j / JUL) so output is routed + structured.',
});
```

## When to apply

- Production code: any class shipped outside the test source set.
- Test files are exempt (`System.out` is sometimes legitimate in
  test harness boilerplate).
- Use `appender` / `MDC` for correlation ids.

## Pattern note

`patterns.javaSystemOut()` covers `print`, `println`, and `printf`
on both `System.out` and `System.err`. For a stricter rule (allow
test classes explicitly) pair with an `excludePaths` glob rather
than weakening the pattern.

## Testing

`examples/java/__fixtures__/java.system-out/{bad,good}.java`
(when present):
- `bad.java`: `System.out.println("hi");` — fires.
- `bad.java`: `System.err.printf("err: %s%n", e.getMessage());` —
  fires.
- `good.java`: `log.info("hi");` — does not fire.
