# Contributing to `@dot-stbl/regent`

> **`.stbl` engineering rules** — see [`.agents/rules/`](.agents/rules) for
> the standards every PR must comply with. The CLI (`bunx
> @dot-stbl/regent check`) catches the local rules once the repo has
> at least one rule file under `examples/` or `tools/audit/rules/`.

## Architecture (v0.2)

`regent` is a **multi-mode static analysis framework** with the LLM
agent as the first-class rule author. Three rule kinds, all sharing
the same engine:

- `.lint.ts` — detect (match → report)
- `.fix.ts` — auto-fix (match → string replace)
- `.transform.ts` — programmatic rewrite (v0.3+)

v0.2 ships **zero bundled rules**. Rules are authored by the user or
agent, either directly in `tools/audit/rules/` or via the shipped
example packs at `examples/<lang>/`.

## Adding a new rule

1. **Pick the kind.** detect for "find this", fix for "auto-rewrite
   this", transform for whole-file programmatic rewrite (v0.3+).

2. **Write the rule file** at `tools/audit/rules/<rule-id>.lint.ts`
   (or `.fix.ts`):

   ```ts
   import { defineDetectRule, patterns } from '@dot-stbl/regent';

   export default defineDetectRule({
     id: 'csharp.no-todo-without-owner',
     severity: 'warning',
     pattern: patterns.todoComment()
       .unlessFollowedBy(patterns.ticketReference())
       .toRegex(),
     globs: ['**/*.cs'],
     excludePaths: ['@generated'],
     message: 'TODO without owner',
     review: {
       enabled: true,
       exitBehavior: 'unreviewed-fails',
       guidance: 'add a ticket ref like TODO(ANL-200)',
     },
   });
   ```

3. **Pair with a fixture** in
   `tools/audit/rules/__fixtures__/<rule-id>/{bad,good}.<ext>`:

   ```cs
   // bad.cs
   public class A { /* TODO follow-up */ }
   ```

   ```cs
   // good.cs
   public class A { /* TODO(ANL-200): follow-up */ }
   ```

4. **Add the companion `.md`** at
   `assets/llm/examples/<lang>/<rule-id>.md` so `regent llm
   examples <lang>.<rule-id>` returns useful prose. Use the format
   in `assets/llm/examples/csharp/no-region-directive.md` as a
   template.

5. **Verify** before committing:

   ```sh
   bun run test test/shipped-examples.test.ts   # L2 fixtures
   bun run typecheck                        # TS strict
   bun run lint                              # eslint
   bun run build && node dist/cli.js check   # dogfood
   ```

The shipped-example fixture test (`test/shipped-examples.test.ts`)
auto-discovers fixture pairs under `examples/<lang>/__fixtures__/`,
so adding a new rule with fixtures requires zero test code.

## Pattern authoring

RE2 syntax differs from JS regex:
- No backreferences (`\\1`)
- No lookbehind (`(?<=...)`) or lookahead (`(?=...)`)
- Use `excludeWhen` for "X but not Y" patterns (positive-match inversion)
- Per-line only — multi-line patterns aren't supported

`@dot-stbl/regent/patterns` ships composable builders for common
shapes:

```ts
import { patterns } from '@dot-stbl/regent';

patterns.todoComment()
  .unlessFollowedBy(patterns.ticketReference())
  .toRegex();
```

Available helpers: `todoComment`, `ticketReference`,
`privateUnderscoreField`, `privateMethod`, `regionDirective`,
`throwVariable`, `taskResultAccess`, `getAwaiterGetResult`,
`configureAwaitFalse`, `discardAssignment`, `bareHttpClient`,
`consoleLog`, `throwNewError`, `tsAnyType`, `trailingWhitespace`,
`mixedIndent`, `finalNewlineMissing`, `tabIndent`,
`fourSpaceIndent`, `twoSpaceIndent`, `packageDeclaration`,
`pythonImport`.

## Severity

| Severity | Exit code | SARIF level | Use for |
|----------|-----------|-------------|---------|
| `error` | 1 | `error` | compilable invariant, fails CI |
| `warning` | 1 (default) | `warning` | convention, breaks house style |
| `suggestion` | 0 | `note` | strong preference, override locally if needed |

The CLI's `--exit-on` flag defaults to `error`; bump to `warning` for
strict-mode CI runs.

## Review-mode rules (tri-state)

When a pattern matches "things that aren't always bad" — TODOs,
short names, sometimes-intentional patterns — use the `review` field.
The runner classifies each finding as `pending` (instead of
`violation`), and the CLI surfaces them in their own section.

```ts
review: {
  enabled: true,
  exitBehavior: 'unreviewed-fails',  // or 'no-fail' (default)
  guidance: 'what the reviewer should check',
}
```

- `no-fail` (default): review findings never affect exit code.
- `unreviewed-fails`: pending finding fails CI at `severity >=
  --exit-on`. Acceptance via `regent accept` clears the failure.

**Always pair review-mode rules with a useful `guidance`** — it's
the text an LLM agent reads when triaging via `regent review`.

## Persistence via accept-list

Once a finding is `pending`, the team can:
- `regent accept <rule-id> <path> --reason "..."` — silences
  specific matches permanently (until the line moves); reason is
  required for audit trail.
- `regent reject <rule-id> <path:line>` — escalates the pending
  finding to a violation (writes to `tools/audit/.rejections.json`,
  gitignored).
- `regent accept ... --scope` writes the entry to committed
  `config.ts` instead of local `config.local.ts` — for project-wide
  accept-lists.

## PR checklist

- [ ] `bun run test` exits 0; new rule fires positive fixture, ignores negative.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun run build && node dist/cli.js check --all` exits 0 in
      `regent/` repo (the tool dogfoods itself).
- [ ] Commit subject follows `[.stbl](feat/<area>): ...` (see
      `commit-format.md`).
- [ ] Companion `.md` added to `assets/llm/examples/<lang>/`.
- [ ] No new file exceeds 300 lines (see `class-layout.md §1b`).
- [ ] No `private` methods in production code (see `code-shape.md §9`).
- [ ] No `ThrowIf*` argument checks under nullable-enable (see
      `code-shape.md §11`).
- [ ] No `matchText` / `pattern` / `path` keys in any log payload
      (use `safeLog()` from the public API).

## Releasing

1. Bump `version` in `package.json` (SemVer; pre-1.0 means anything
   can break between minors).
2. `git tag v0.X.Y && git push --tags`
3. `.github/workflows/release.yml` runs OIDC trusted-publishing to
   GitHub Packages under `@dot-stbl/regent`.

## Development workflow

```sh
# Setup
bun install
bun run build       # tsc → dist/
bun run typecheck   # tsc --noEmit
bun run lint        # eslint
bun run test        # vitest run
bun run smoke       # build + node dist/cli.js check --help

# Run a specific test file
bunx vitest run test/loader.test.ts
bunx vitest run test/loader.test.ts -t "loads no rules"

# Watch tests during development (NOT in agent — this would leak)
# bunx vitest
```

**Important:** `regent` ships a CLI. **Do not run `node dist/cli.js
check` repeatedly** during agent sessions — it spawns a process
per invocation and can hit the rate limit. Use `bun run test` for
verification; CI invokes the same script so Vitest and `vitest.config.ts`
behave consistently in both environments. The runner is invoked from a
short-lived test process that exits cleanly.

## Logging conventions

`regent` uses **pino** for operational logs:

- stdout = data (findings, reports, banners)
- stderr = logs (errors, status, perf metrics)
- Use `safeLog(logger, level, payload, msg?)` from
  `@dot-stbl/regent/logging` to enforce redaction of `matchText`,
  `pattern`, and `path` (these may contain secrets).

```ts
import { createLogger, safeLog } from '@dot-stbl/regent';

const logger = createLogger({ level: 'info', format: 'text' });

safeLog(logger, 'info', { ruleId: 'csharp.no-region', count: 3 }, 'rule fired');
// Outputs: ... "msg":"rule fired" "ruleId":"csharp.no-region" "count":3
// (matchText, pattern, path would be redacted)
```

## Layered config

`regent` reads config from multiple sources, merged in precedence
order (low → high):

1. Built-in defaults
2. User-global: `~/.config/regent/config.{ts,js,yaml,json}`
3. Project: `.regentrc.{ts,js,yaml,json}` (via cosmiconfig, walks up)
4. Per-developer: `.regentrc.local.*` (gitignored)
5. Env: `STBL_REGENT_*`
6. CLI args (highest)

For `extends` to npm packages (Phase 3+, `regent-rules-*`), declare
the package's expected shape:

```ts
{
  "name": "@scope/regent-rules-csharp",
  "main": "index.js",
  "exports": { ".": "./index.js" }
}
```

`extends: '@scope/regent-rules-csharp'` resolves the package and
imports its default export (a `RuleSpec[]`).
