# java.empty-catch-block

`catch (Exception e) {}` silently swallows the exception — operators
see a "stuck" downstream call with no diagnostic. At minimum log;
usually propagate or convert to a domain error.

## Code

```ts
// examples/java/java.empty-catch-block.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'java.empty-catch-block',
  severity: 'warning',
  pattern: '\\bcatch\\s*\\([^)]+\\)\\s*\\{\\s*\\}',
  excludePaths: ['**/test/**', '**/tests/**'],
  globs: ['**/*.java'],
  message:
    'Empty `catch` block silently swallows the exception. Log, ' +
    'rethrow, or convert to a domain error.',
});
```

## When to apply

- Production handlers, services, and library code.
- Test files are exempt — empty catches are a legitimate signal in
  tests (`assertThrows`-style harness plumbing).

## Pattern note

The pattern is line-scoped: a multi-line empty `catch` is detected
when the closing `}` lands on the same line as the catch header.
For whole-method catches use a follow-up review pass; this rule
flags the common shape.

## Testing

`examples/java/__fixtures__/java.empty-catch-block/{bad,good}.java`
(when present): `bad.java` has `catch (IOException e) {}`, fires.
