# Contributing to `@dot-stbl/regent`

> **`.stbl` engineering rules** — see [`.agents/rules/`](.agents/rules) for
> the standards every PR must comply with. The CLI (`bunx
> @dot-stbl/regent check`) catches the local rules once the repo has
> at least one rule file under `examples/` or `tools/audit/rules/`.

## Architecture (v0.4)

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

## Function-form fix contract

Function-form fixes MUST be pure and deterministic. They must not perform I/O,
read time, randomness, or clocks, or mutate global state. Returning `null`
declines the fix, while returning an empty array `[]` is a valid result with no
edits to apply. If a function throws, the engine catches the exception, logs a
warning, continues the run, and drops that function's edits.

This contract lets the engine run its fixpoint loop deterministically and makes
CI-applied diffs reproducible for users reviewing the same input and rule set.

## Authoring a parameterized rule

When a rule's `pattern` / `message` depends on values that should
live in the config (the project's settings, not hardcoded in the
rule), use `defineParameterizedRule` and a zod `params` schema:

```ts
import { z } from 'zod';
import { defineParameterizedRule } from '@dot-stbl/regent';

export default defineParameterizedRule({
  id: 'csharp.max-line-length',
  severity: 'warning',
  params: z.object({
    max: z.number().int().min(40).default(120),
    excludeImports: z.boolean().default(false),
  }),
  pattern: (p) => p.excludeImports
    ? `^(?!\\s*using\\s).*.{${String(p.max + 1)},}$`
    : `^.{${String(p.max + 1)},}$`,
  globs: ['**/*.cs'],
  message: (p) => `line exceeds ${String(p.max)} chars`,
});
```

Function-typed fields (`pattern`, `excludeWhen`, `message`) take the
inferred params (`z.infer<typeof schema>`) at materialisation time
and return a string. Plain string values are still accepted for
fields that don't need parameters.

### Configuring values

Per-rule values live in `.regentrc.ts` under `rules.configure`:

```ts
export default {
  rules: {
    configure: {
      'csharp.max-line-length': { max: 100, excludeImports: true },
    },
  },
};
```

Values are validated against the rule's `params` schema at load
time; missing keys default to the schema's own `.default()`. An
unknown rule id in `configure` is silently ignored (so projects can
roll out the feature gradually); a value that fails the schema is a
hard load-time error with the path into the value.

### Introspection

`regent describe <ruleId>` (after 33c lands) emits the params JSON
Schema so an LLM agent or a human can see exactly which knobs are
available and their defaults — same workflow as running
`regent config show`, scoped to a single rule.

## Authoring a fix

A rule's optional `fix` attachment tells `regent fix` how to auto-rewrite
the matched substring. The shape lives in [`src/types.ts`](src/types.ts)
as the discriminated union `RuleFixSpec`:

```ts
type RuleFixSpec =
  | RuleFixReplace        // { kind: 'replace', template: string }
  | RuleFixDeleteLine     // { kind: 'delete-line', alsoDeleteMatching?: string }
  | RuleFixFunction       // { kind: 'function', apply: (ctx) => FixEdit[] | null }
  | RuleFixGuidanceOnly;  // { kind: 'guidance-only' }
```

Every kind carries `safety: 'safe' | 'suggested'` + `title: string` +
optional `guidance` + optional `converges?: boolean` (the
`RuleFixBase` shape). The loader enforces a safety↔kind invariant:
`{ safety: 'safe', kind: 'guidance-only' }` is rejected at startup.

### The four kinds

#### `kind: 'replace'` — match → substitute (declarative)

```ts
fix: { kind: 'replace', safety: 'safe', title: 'csharp.swap', template: '$2-$1' }
```

The `template` may be empty (`template: ''` deletes the match). Capture
groups from `pattern` expand via:

| Token | Meaning |
|-------|---------|
| `$1`, `$2`, … | Numeric capture group (1-indexed). |
| `${name}` | Named capture group (when the runner exposes groupsByName). |
| `$$` | Literal `$` (escape). |

Unresolved references (e.g. `$99` when only 3 groups exist) are left
verbatim in the output so the failure is visible in the diff. An
optional `targetGroup` field restricts the replacement to a capture
group's span instead of the whole match.

#### `kind: 'delete-line'` — drop the matched line

```ts
fix: { kind: 'delete-line', safety: 'safe', title: 'meta.drop-region' }
```

Drops the matched line + trailing `\n`. `alsoDeleteMatching` (an RE2
pattern) drops a paired line — useful for paired shapes like
`#region` ↔ `#endregion`.

#### `kind: 'function'` — programmatic

```ts
fix: {
  kind: 'function',
  safety: 'safe',
  title: 'csharp.exceptions.brace-style',
  apply: ({ filePath, content }) => {
    /* compute byte-span edits; return FixEdit[] or null */
  },
}
```

The shape declarative kinds can't express. `apply(ctx)` receives
`{ filePath, content }` and returns `readonly FixEdit[] | null`:

```ts
interface RuleFixEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}
```

Offsets are file-absolute byte positions. Returning `null` declines
the rewrite; `[]` is a valid empty result. **Pure + deterministic**
contract — see "Pure + deterministic contract" below.

#### `kind: 'guidance-only'` — surface, never apply

```ts
fix: { kind: 'guidance-only', safety: 'suggested', title: 'csharp.refactor', guidance: 'what to check' }
```

No edit produced. The `title` + `guidance` land in the agent's
`suggested[]` block (text + JSON wire format); the agent (or human)
applies judgement. The only valid kind for `safety: 'suggested'`
without `--unsafe`.

### Safety lanes — what the CLI does with each

| `safety` | `regent fix` default | With `--unsafe` (P7) |
|----------|----------------------|----------------------|
| `'safe'` | auto-applies | auto-applies |
| `'suggested'` + `replace` / `delete-line` / `function` | surfaces in `suggested[]` | applies |
| `'suggested'` + `guidance-only` | surfaces in `suggested[]` | surfaces in `suggested[]` (never applies) |

The JSON wire format (P5) separates the three buckets at the top level
— `applied` / `suggested` / `deferred` — so agents can branch on shape
without re-deriving which edits landed.

**Recommendation:** keep `safe` small. Reserve it for mechanically
semantics-preserving edits (a no-op `.ConfigureAwait(false)` call in
app code; a paired `#region` / `#endregion` deletion). Anything that
deserves a human's review (refactors, semantic rewrites, deletes of
unclear intent) belongs in `safety: 'suggested'` so the agent or
human reads the diff before applying.

### Template syntax (`replace.kind === 'replace'`)

See the table above. `$1`–`$9` for numeric groups, `${name}` for named
groups, `$$` for a literal `$`. The template is applied literally —
TS source `"\\n"` becomes the 2-char sequence `\n` on disk, not a
newline. To insert a newline, use `"\n"` in the template.

### `converges?: boolean` — opt-in to the fixpoint loop (P4)

```ts
fix: { kind: 'delete-line', safety: 'safe', title: 'meta.strip-blank', converges: true }
```

`converges: true` opts the rule into `applyFixes`'s fixpoint re-scan:
after each pass, the engine re-detects the changed file and re-applies
any new findings whose rule also opted in. The loop stops when:

- a pass produces no edits (converged);
- `maxPasses` (default 5, hard cap 20) is exceeded →
  `ApplyFixesConvergenceError` with per-file stats;
- the run produces an identical pass set (idempotence guard).

**Default: `false`** — most rules are single-pass. Mark `converges: true`
ONLY when the fix is mechanically idempotent: `delete-line`, or
`replace` with a fixed template whose replacement doesn't re-trigger
detection. Rules whose replacement can produce chained edits MUST NOT
set this flag; they'd loop until `maxPasses` is exhausted and
`ApplyFixesConvergenceError` fires.

### Pure + deterministic contract (long form)

`RuleFixFunction.apply` MUST be:

- **Pure**: no I/O, no global state mutation, no time / randomness / clock reads. Reads the supplied `ctx` only.
- **Deterministic**: same `(ctx)` → same return value. Required so the
  content-hash cache + the fixpoint loop are reproducible; CI diffs
  are byte-stable for the same input + rule set.

Returning `null` declines the rewrite (no edit produced, no surface
in `applied` / `suggested`). Returning `[]` is a valid empty result —
no edits to apply, but no decline.

If a function throws, the engine catches the exception, logs a one-line
warning to stderr (`warning: function fix <ruleId> threw; edits dropped`),
and drops that rule's edits for the rest of the run. The rest of the
run continues; one buggy function fix does not bring down the engine.

This contract lets the engine run the fixpoint loop deterministically
and makes CI-applied diffs reproducible for users reviewing the same
input and rule set.

### Adding a `fixed.<ext>` to your fixture

Every shipped fixable rule carries a `{bad,good,fixed}.<ext>` triple
under `examples/<lang>/__fixtures__/<rule>/`. `fixed.<ext>` is the
**literal engine output**, not a human-cleaned shape — it equals what
`regent fix` produces against `bad.<ext>` in a tmpdir. `good.<ext>`
may differ from `fixed.<ext>` — `good.<ext>` is the human-cleaned
final shape (with the chain collapsed onto one line, imports
reordered, etc.), while `fixed.<ext>` is the literal mechanical
output.

To regenerate `fixed.<ext>` after a rule change:

1. Copy `bad.<ext>` to a scratch tmpdir.
2. Copy the rule's `.lint.ts` into `tmpdir/tools/audit/rules/`.
3. Run `node dist/cli.js fix --yes` (add `--unsafe` if the rule's
   `kind` is `function`).
4. Read the on-disk file back. That IS `fixed.<ext>`.

The shipped-examples test (`test/shipped-examples.test.ts`) auto-
discovers fixture pairs and asserts `fixed.<ext>` equals the engine
output. It does NOT assert `fixed.<ext>` equals `good.<ext>` —
those can legitimately diverge.

### See also

- README "Writing a fix" — the short form.
- `src/types.ts` — `RuleFixSpec` discriminated union +
  `validateFixSpec` invariants.
- `src/fixer.ts` — the `applyFixes` engine + the fixpoint loop.
- `assets/llm/authoring/fix.md` — `regent llm authoring fix` doc
  (CLI-facing prose version of this section).
- `assets/llm/schema/fix-v1.json` — the `regent fix --format json`
  output schema (the wire format agents consume).
- `assets/llm/examples/<lang>/<rule>.md` — per-shipped-rule docs
  that pick a `safety` lane and show the bad → fixed diff.

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
`pythonImport`, `javaPublicClass`, `javaSystemOut`, `javaOverride`,
`goPackageDecl`, `goImport`, `goFuncMain`, `goPrintln`, `goPanic`,
`rustPubFn`, `rustUseCrate`, `rustUnsafe`, `rustUnwrap`.

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
3. `.github/workflows/release.yml` runs on the `v*` tag push and
   publishes `@dot-stbl/regent` to **npmjs.com** under the `@dot-stbl`
   scope (`--access public`). The job depends on a GitHub Environment
   `npm-publish` with an `NPM_TOKEN` secret — see repo Settings.

## Commit attribution policy

Commits in this repository are attributed to humans only. AI
assistants (Claude Code, Claude Opus, or any other LLM-based tool)
must **not** be added to commit messages — neither as
`Co-Authored-By:`, `Contributed-By:`, `Contribute-By:`,
`Assisted-By:`, nor `Generated-By:` trailers.

The `regent-agent` identity used by local LLM tooling is itself
mapped to a generic contributor via `.mailmap` so it does not
appear in `git shortlog` or GitHub's Insights → Contributors graph.

AI-assisted work is credited in the **commit body** when relevant
("drafted with Claude; reviewed by @author"), but never as a
machine-parseable trailer.

This is enforced by CI (`.github/workflows/lint-commits.yml`).

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

For `extends` to npm packages (`@scope/regent-rules-*`), declare
the package's expected shape:

```ts
{
  "name": "@scope/regent-rules-csharp",
  "main": "index.js",
  "exports": { ".": "./index.js" }
}
```

`extends: '@scope/regent-rules-csharp'` resolves the package via
Node's CommonJS resolution anchored at `loader.ts` (so the user's
own `node_modules` is searched) and dynamic-imports the resolved
file. The package must expose a rule shape — a `default` export
(either a single spec or an array), a `rule` export, or any named
export whose value matches the `RuleSpec` discriminator.

Bare unprefixed specifiers (no `@scope/`) are intentionally not
treated as npm packages — that's where the legacy preset-name
confusion lived; use a relative prefix (`./packages-foo`) for local
paths. The legacy `@dot-stbl/regent/presets/<lang>` strings still
throw a clear error to surface drift from the v0.2 preset removal.

A missing or malformed plugin surfaces as a `regent` error with the
spec and the underlying `ERR_MODULE_NOT_FOUND` (or similar),
naming the install command (`npm/pnpm/bun install`) to fix it.
