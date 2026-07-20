# meta.trailing-newline

Every file should end with a single newline. Use this as a template
for any **fix rule** (not just detect).

## Code

```ts
// examples/meta/trailing-newline.fix.ts
import { defineFixRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineFixRule({
  id: 'meta.trailing-newline',
  severity: 'warning',
  find: patterns.finalNewlineMissing().toRegex(),
  replace: '\n',
  all: false,  // only the very last line; no need to apply to every match
  globs: ['**/*'],
  excludePaths: ['@generated', '@node-modules', '@build-output'],
  message: 'ensure file ends with a newline',
});
```

## Idempotency check

- `find: '[^\\n]\\z'` matches a file that doesn't end with `\n`.
- `replace: '\n'` appends a newline.
- After fix, `[^\\n]\\z` no longer matches — **idempotent**. Safe.

## When to apply

- POSIX file convention.
- `git diff` shows the trailing-newline change as a clean `\ No
  newline at end of file` → `+` line.
- Pair with `meta.no-trailing-whitespace` for full hygiene.

## Testing

- `bad.txt` ends with `no newline` (no `\n`).
- `good.txt` ends with `newline\n`.
- After `regent fix --write`, `bad.txt` should equal `good.txt`.
