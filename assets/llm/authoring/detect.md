# Authoring detect rules

Detect rules match lines in source files and report findings.
Files use the `.lint.ts` extension. Pattern is RE2 — linear-time,
no ReDoS surface.

## Skeleton

```ts
// <rule-id>.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'csharp.no-todo-without-owner',
  severity: 'error',                    // error | warning | suggestion
  pattern: '//\\s*(TODO|FIXME)\\b',     // RE2 source
  excludeWhen: '//\\s*(TODO|FIXME)\\s*\\(',
  globs: ['**/*.cs'],
  excludePaths: ['@generated'],         // opt-in exclude group
  message: 'TODO without owner',
  source: 'code-shape.md#todo-without-owner',  // optional, auto-derived from sibling .md
  rationale: 'every TODO needs a ticket reference',  // optional
  review: {                             // optional — tri-state review
    enabled: true,
    exitBehavior: 'unreviewed-fails',  // or 'no-fail'
    guidance: 'add a ticket ref like TODO(ANL-123)',
  },
  dependsOn: ['other-rule-id'],         // optional — DAG ordering
});
```

## Field reference

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | stable id, namespaced (`<lang>.<topic>`) |
| `severity` | yes | `error` (CI fail) / `warning` (CI fail by default) / `suggestion` (CI pass) |
| `pattern` | yes | RE2 pattern, applied per-line |
| `excludeWhen` | no | RE2 pattern; matches skip the finding (positive-match inversion) |
| `globs` | yes | file globs to scan |
| `excludePaths` | no | file globs OR `@group` refs to skip |
| `message` | yes | short human-readable message |
| `source` | no | back-link to the `.md` prose (auto-derived from sibling `.md` if omitted) |
| `rationale` | no | longer explanation shown above the context snippet |
| `review` | no | tri-state review spec (see below) |
| `dependsOn` | no | rule ids that must run first (DAG) |

## RE2 cheatsheet

- `\\b` — word boundary
- `\\s` — whitespace, `\\d` — digit
- `^` — start ofc line, `$` — end of line
- `(a|b)` — alternation, `(?:...)` — non-capturing group
- `.*?` — lazy, `[^x]` — negated class
- NO backrefs `\\1`, NO lookahead `(?=...)`, NO lookbehind `(?<=...)`
- `\\(` literal `(`, `\\)` literal `)`, `\\{` literal `{`, etc.

## Composing "X but not Y"

RE2 has no negative lookahead. The standard idiom:

```ts
pattern: 'X',                  // matches X
excludeWhen: 'Y',              // matches that ALSO match Y are dropped
```

For "TODO with ticket" detection (positive):

```ts
pattern: '//\\s*(TODO|FIXME)\\b',
excludeWhen: '//\\s*(TODO|FIXME)\\s*\\(',  // has parenthetical ticket ref
```

## Tri-state review

```ts
review: {
  enabled: true,
  exitBehavior: 'unreviewed-fails',   // or 'no-fail' (default)
  guidance: 'what the reviewer should check',
}
```

- `no-fail` (default): review findings never fail CI.
- `unreviewed-fails`: pending findings fail at `severity >= --exit-on`.
  Acceptance via `regent accept` clears the failure.

## Pre-built composable patterns

```ts
import { patterns } from '@dot-stbl/regent';

defineDetectRule({
  id: 'csharp.no-todo-without-owner',
  pattern: patterns.todoComment()
    .unlessFollowedBy(patterns.ticketReference())
    .toRegex(),
  globs: ['**/*.cs'],
  message: 'TODO without owner',
});
```

Available helpers in `patterns`:
`todoComment()`, `ticketReference()`, `privateUnderscoreField()`,
`privateMethod()`, `regionDirective()`, `throwVariable()`,
`taskResultAccess()`, `getAwaiterGetResult()`, `configureAwaitFalse()`,
`discardAssignment()`, `bareHttpClient()`, `consoleLog()`,
`throwNewError()`, `tsAnyType()`, `trailingWhitespace()`,
`mixedIndent()`, `finalNewlineMissing()`, `tabIndent()`,
`fourSpaceIndent()`, `twoSpaceIndent()`, `packageDeclaration()`,
`pythonImport()`, `javaPublicClass()`, `javaSystemOut()`,
`javaOverride()`, `goPackageDecl()`, `goImport()`, `goFuncMain()`.

## Per-line scope

Patterns are evaluated per line. Multi-line matches are not
supported. Compose per-line patterns + use `excludeWhen` for
context.

## Sibling `.md` prose

Each `.lint.ts` file is paired with a sibling `.md` of the same
basename. The loader auto-derives `spec.source` from the sibling
`.md` path. The `.md` should explain the rule's rationale — it's
the document the agent reads when triaging findings.

## Testing

Create `examples/<rule-id>/{bad,good}.cs` (or whatever extension
your globs cover). The fixtures test asserts:
- `bad.<ext>` produces at least one finding
- `good.<ext>` produces zero findings

See `test/fixtures.test.ts` for the test helper.

## Acceptance

Pending review findings are silenced via:
```
regent accept <rule-id> <path> --reason "..."
```

Reason is mandatory (500 chars max), audit-trail.
