# Contributing to `@dot-stbl/regent`

> **`.stbl` engineering rules** — see [`.agents/rules/`](.agents/rules) for
> the standards every PR must comply with. The CLI (run `bunx @dot-stbl/regent
> check` in your own repo) catches `naming-and-types`, `code-shape`,
> `anti-patterns` violations + project-specific conventions from
> `~/.agents/rules/csharp/`.

## Adding a new rule

1. Create the prose `*.md` file alongside your rule. Use H2/H3 headings;
   subsequent H1 becomes the rule id's documentation link.
2. Create the executable `*.rule.ts` file next to the prose. Use
   `defineRule` from `@dot-stbl/regent` for type-safe narrowing:

   ```ts
   import { defineRule } from '@dot-stbl/regent';

   export default defineRule({
     id: 'csharp.my-new-rule',
     severity: 'error',
     pattern: '^\\s*Something\\b',
     globs: ['**/*.cs'],
     excludePaths: ['**/bin/**', '**/obj/**'],
     message: 'one-line summary',
     rationale: 'longer explanation shown above the context snippet',
   });
   ```

3. **Pattern is RE2 syntax.** Avoid backreferences and lookahead;
   `re2-wasm` rejects them. Use word-boundary `\b` instead of trailing
   `\\s` when you want to match end-of-word without requiring whitespace.
   For "match X but not when Y" patterns, use a positive `excludeWhen`
   on the rule instead of negative lookahead.
4. **Always include a positive AND negative fixture** in
   `test/fixtures/<rule-id>/`. PR without fixtures is rejected by
   reviewer.
5. Run `bun test` — fixture tests are L2 in the pyramid.

### Severity

| Severity | Exit code | SARIF level | Use for |
|---|---|---|---|
| `error` | 1 | `error` | Compilable invariant. Wrong code that won't deploy. |
| `warning` | 1 (default) | `warning` | Convention. Code works but breaks house style. |
| `suggestion` | 0 | `note` | Strong preference. Override locally if you have reasons. |

The CLI's `--exit-on` flag defaults to `error`; bump to `warning` for
strict-mode CI runs.

### Review-mode rules (tri-state)

When a pattern matches "things that aren't always bad" — TODOs,
short names, pattern matches that are sometimes intentional — use
the `review` field. The runner then classifies each finding as
`pending` (instead of `violation`), and the CLI emits them in their
own "Review candidates" section.

```ts
export default defineRule({
  id: 'csharp.no-todo-without-owner',
  severity: 'warning',
  pattern: '//\\s*(TODO|FIXME)\\b',
  excludeWhen: '//\\s*(TODO|FIXME)\\s*\\(',
  globs: ['**/*.cs'],
  message: 'TODO без owner',
  review: {
    enabled: true,
    exitBehavior: 'unreviewed-fails',
    guidance: 'проверь что у TODO есть owner/ticket ...',
  },
});
```

`exitBehavior` choices:
- `no-fail` (default) — review findings never affect exit.
- `unreviewed-fails` — pending finding fails CI unless accepted.

**Always pair review-mode rules with a useful `guidance`** — it's the
text an LLM agent reads when triaging via `regent review`.

### Persistence via accept-list

Once a finding is `pending`, the team can:
- `regent accept <rule-id> <path>:<line> --reason "..."` — silences
  specific matches permanently (until the line moves); reason is
  required for audit trail.
- `regent reject <rule-id> <path>:<line>` — escalates the pending
  finding to a violation (writes to `tools/audit/.rejections.json`,
  gitignored).
- `regent accept ... --scope` writes the entry to committed
  `config.ts` instead of `config.local.ts` — for project-wide
  accept-lists.

### PR checklist

- [ ] `bun test` exits 0; new rule fires positive fixture, ignores negative.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run build && bunx @dot-stbl/regent check --all` exits 0 inside `regent/`.
  (meta — the tool dogfoods itself.)
- [ ] Commit subject follows `[.stbl](feat/<area>): ...` (see `commit-format.md`).
- [ ] No `private` methods in production code, no `ThrowIf*`, no
  unused-`!` — see `code-shape.md`, `nullability.md`.

## Releasing

1. Bump `version` in `package.json` (SemVer; pre-1.0 means anything
   can break between minors).
2. `git tag v0.X.Y && git push --tags`
3. `.github/workflows/release.yml` runs OIDC trusted-publishing to
   GitHub Packages under `@dot-stbl/regent`.
