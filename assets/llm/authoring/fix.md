# Authoring fix rules

Fix rules match a pattern and apply a string replacement. Files use
the `.fix.ts` extension. `--check` exits 1 if a fix would change a
file; `--write` writes changes to disk.

## Skeleton

```ts
// <rule-id>.fix.ts
import { defineFixRule } from '@dot-stbl/regent';

export default defineFixRule({
  id: 'meta.trailing-whitespace',
  severity: 'warning',
  find: '[ \\t]+$',                  // RE2 source (multiline per-line)
  replace: '',                      // string form only — no function form
  all: true,                        // default true: replace every match
  globs: ['**/*'],
  excludePaths: ['@generated'],
  message: 'strip trailing whitespace',
  dependsOn: ['some-detect-rule'],
});
```

## Idempotency contract

**A fix rule's `replace` must produce a string that, if re-applied
to the same input, would no longer match `find`.** Otherwise
`--check` reports a diff every run (infinite-loop class bug).

Examples:
- `find: '[ \\t]+$'` + `replace: ''` — IDEMPOTENT. Re-scanning
  the replaced line finds no more trailing whitespace.
- `find: 'a'` + `replace: 'b'` — idempotent. After replacement,
  no more `a` on this line.
- `find: 'a'` + `replace: 'aa'` — **NOT idempotent**. Re-scanning
  finds `aa`, replaces with `aaa`, etc. **Bug.**

## `find` syntax

RE2 source. Per-line, multiline. Capturing groups (when present)
are not yet surfaced for `replace` — keep `find` patterns simple.

## `replace` syntax

**String form only in v0.2.** Function-form replacement (e.g.
`replace: (match, ctx) => string`) is **forbidden** — non-pure
functions defeat the content-hash cache. The runner verifies
`replace` is a string at load time.

For deterministic transformations that need context (e.g.
replace with line number), use a detect rule + a fix rule with
`dependsOn`. The fix rule reads findings from the detect rule
through its `ctx.findingsFrom(ruleId)` API (Phase 4+).

## String escaping

The `replace` string is applied literally. Common gotchas:
- `\\n` in TS source is the 2-char sequence `\` + `n`. The runner
  does NOT interpret backslash escapes; pass `'\n'` if you want a
  newline, or the literal characters `\\n` if you want backslash-n.
- `\\1`, `\\2` for capture groups — NOT supported in v0.2. Avoid
  patterns that need backrefs.

## Pre-built composable patterns

`patterns` from `@dot-stbl/regent` covers the common shapes:
`trailingWhitespace()`, `mixedIndent()`, `finalNewlineMissing()`,
`tabIndent()` / `fourSpaceIndent()` / `twoSpaceIndent()`.

```ts
import { patterns } from '@dot-stbl/regent';

defineFixRule({
  id: 'meta.final-newline',
  find: '[^\\n]\\z',
  replace: '\\n',
  globs: ['**/*'],
  message: 'ensure file ends with newline',
});
```

## Dry-run with `--check`

`regent fix --check` (default) computes the diff and exits non-zero
if any file would change. Use in CI to gate auto-fix rollouts.

`regent fix --write` actually writes the changed files. Combined
with a pre-commit hook, this keeps repos formatted without manual
intervention.

## Safety

A fix rule that produces a no-op (or worse, a non-idempotent
change) is a bug — fix the rule, not the user's project. The
runner surfaces non-idempotent fixes with a warning at load time
(Phase 4+).

`--write` skips the git working tree. The diff is emitted to
stdout; review before committing.
