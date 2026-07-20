# meta.no-trailing-whitespace

Strip trailing whitespace at end of line. Use as a template for
any "formatting hygiene" fix rule.

## Code

```ts
// examples/meta/no-trailing-whitespace.fix.ts
import { defineFixRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineFixRule({
  id: 'meta.no-trailing-whitespace',
  severity: 'warning',
  find: patterns.trailingWhitespace().toRegex(),
  replace: '',
  all: true,
  globs: ['**/*'],
  excludePaths: ['@generated', '@node-modules', '@build-output', '**/*.md'],
  message: 'strip trailing whitespace at end of line',
});
```

## Idempotency

- `find: '\\s+$'` matches a line with trailing whitespace.
- `replace: ''` removes it.
- After fix, the line has no trailing whitespace — `\\s+$` no
  longer matches. **Idempotent.** Safe.

## Why `**/*.md` is excluded

Markdown uses two trailing spaces for hard line breaks. Stripping
trailing whitespace would change rendered output. Markdown authors
should opt in explicitly if they want this rule.

## When to apply

- Pair with `meta.trailing-newline` for full file hygiene.
- Run via `regent fix --check` in CI to gate rollouts.

## Testing

- `bad.txt` has lines like `hello   ` and `world\t` — both fire.
- `good.txt` has no trailing whitespace — does not fire.
- After `regent fix --write`, `bad.txt` should equal `good.txt`.
