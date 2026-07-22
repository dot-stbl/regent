<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/header-dark.svg">
    <img alt="regent by .stbl" src="assets/header-light.svg">
  </picture>
</p>

<p align="right">
  <a href="https://github.com/dot-stbl/regent/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/dot-stbl/regent/ci.yml?branch=main&label=ci"></a>
  <a href="https://github.com/dot-stbl/regent/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/dot-stbl/regent"></a>
  <a href="https://github.com/dot-stbl/regent/tags"><img alt="Version" src="https://img.shields.io/github/v/tag/dot-stbl/regent"></a>
</p>

<p align="center">
  <strong>Multi-mode static analysis framework for LLM agents.</strong>
  <br>
  Detect. Fix. Cache. Review. Zero bundled rules.
  <br><br>
  <a href="#install">Install</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#writing-a-rule">Writing a rule</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/dot-stbl/brand">Brand</a>
</p>

---

## What it does

`regent` is a **multi-mode static analysis framework** for any
language, with the agent as the first-class rule author. Three rule
kinds:

- **detect** (`.lint.ts`) — match → report (eslint-style)
- **fix** (`.fix.ts`) — match → string replace (prettier-lite)
- **transform** (`.transform.ts`) — programmatic rewrite (v0.3+)

`regent` ships **zero rules by default**. Every rule is authored by
the user or LLM agent. Curated examples live under `examples/<lang>/`
and are accessed via `regent example copy <lang> <rule-id>`.

Pattern matching uses **RE2** (linear-time, no ReDoS surface);
`re2-wasm` enforces RE2 syntax at compile time. Multi-line matches
are not supported — compose per-line patterns and use `excludeWhen`
for context.

## Install

`@dot-stbl/regent` ships on **npmjs.com** under the `@dot-stbl` scope.
No GitHub Packages PAT required — install like any other public package.

```sh
# Project dependency
bun add @dot-stbl/regent

# Global CLI (binary `regent` becomes available on PATH)
bun add -g @dot-stbl/regent

# Run without install (bunx caches on first use)
bunx @dot-stbl/regent check
```

## Quickstart

```sh
# 1. Scaffold tools/audit/ + AGENT.md in your repo
regent init

# 2. Browse curated examples (multi-page docs the agent reads)
regent llm examples csharp
regent llm examples csharp.no-todo-without-owner

# 3. Copy an example into your project
regent example copy csharp no-todo-without-owner

# 4. Run rules
regent check
regent fix --check
regent fix --write

# 5. Review tri-state candidates
regent review
regent accept csharp.no-todo-without-owner src/Foo.cs \
    --reason "legacy file, tracked in ANL-200"

# 6. Cache + benchmark
regent cache stats
regent benchmark
```

## How it works

`regent` reads **config files** alongside the **rules** they
reference, runs them across your repository, and reports findings
as styled text (for terminals and agents) or **SARIF 2.1** (for CI /
GitHub code scanning).

### Config layers (low → high precedence)

1. **Built-in defaults** — `info` log level, `text` format, cache on.
2. **User-global config** — `~/.config/regent/config.{ts,js,yaml,json}`.
3. **Project config** — `.regentrc.{ts,js,yaml,json}` (via cosmiconfig,
   walks up from cwd).
4. **Per-developer config** — `.regentrc.local.*` (gitignored).
5. **Env vars** — `STBL_REGENT_LOG_LEVEL`, `STBL_REGENT_LOG_FORMAT`,
   `STBL_REGENT_CACHE_ENABLED`, …
6. **CLI args** — `--log-level`, `--log-format`, `--no-cache`.

Config is validated by Zod strict mode at load time — unknown keys
fail-fast.

### Named exclude groups

Rules reference **named groups** in `excludePaths` instead of long
glob lists. Built-ins:

| Group | Globs |
|-------|-------|
| `@generated` | `**/*.g.cs`, `**/*.Designer.cs`, `**/Generated/**`, … |
| `@migrations` | `**/Migrations/**` |
| `@build-output` | `**/bin/**`, `**/obj/**`, `**/dist/**`, … |
| `@node-modules` | `**/node_modules/**` |
| `@git` | `**/.git/**` |
| `@ide` | `**/.vscode/**`, `**/.idea/**` |
| `@vendored` | `**/vendor/**`, `**/third_party/**` |

```ts
excludePaths: ['@generated', '@build-output', '**/legacy/**']
```

User-defined groups override built-ins. Declare under `excludeGroups`
in your `.regentrc.*`:

```ts
export default defineConfig({
  excludeGroups: {
    'contract-tests': ['**/ContractTests/**'],
  },
  // ...
});
```

### Tri-state review

Rules with `review.enabled` produce `pending` findings instead of
violations. Surface them via `regent review` and triage with
`regent accept` (silence) or `regent reject` (escalate). Review
findings don't fail CI on their own unless
`review.exitBehavior: 'unreviewed-fails'`.

## Writing a rule

```ts
// rules/csharp.no-todo-without-owner.lint.ts
import { defineDetectRule, patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'csharp.no-todo-without-owner',
  severity: 'warning',
  pattern: patterns.todoComment()
    .unlessFollowedBy(patterns.ticketReference())
    .toRegex(),
  globs: ['**/*.cs'],
  excludePaths: ['@generated'],
  message: 'TODO without a ticket reference',
  review: {
    enabled: true,
    exitBehavior: 'unreviewed-fails',
    guidance: 'Add a ticket ref like TODO(ANL-200) or accept with reason.',
  },
});
```

Companion `.md` (auto-discovered as `spec.source`):

```md
# csharp.no-todo-without-owner

Every TODO needs a ticket ref. See
[code-shape.md §todo-without-owner](https://github.com/dot-stbl/regent/blob/main/assets/llm/authoring/detect.md).
```

Full authoring guides:

```sh
regent llm authoring detect
regent llm authoring fix
regent llm schema detect
regent llm examples csharp
```

## Writing a fix

A rule's optional `fix` attachment tells `regent fix` how to auto-rewrite
the matched substring. The shape is a discriminated union of four
`RuleFixSpec` kinds (`replace` / `delete-line` / `function` /
`guidance-only`), each with a `safety: 'safe' | 'suggested'` lane that
controls whether the CLI auto-applies or surfaces for review.

### `kind: 'replace'` — match → substitute (declarative)

```ts
fix: { kind: 'replace', safety: 'safe', title: 'csharp.swap', template: '$2-$1' }
```

The `template` may be empty (delete the match). Capture groups from
`pattern` expand via `$1`, `$2`, `${name}`; `$$` is a literal `$`.
Unresolved references (e.g. `$99` when only 3 groups exist) are
preserved verbatim in the output so the failure is visible in the diff.

### `kind: 'delete-line'` — drop the matched line

```ts
fix: { kind: 'delete-line', safety: 'safe', title: 'meta.drop' }
```

Drops the matched line + trailing `\n`. `alsoDeleteMatching` (RE2) drops
a paired line (e.g. `#endregion` next to `#region`).

### `kind: 'function'` — programmatic, for declarative-incapable edits

```ts
fix: {
  kind: 'function',
  safety: 'safe',
  title: 'csharp.exceptions.brace-style',
  apply: ({ content }) => {
    /* pure + deterministic — see "Authoring a fix" in CONTRIBUTING.md */
  },
}
```

Returns `FixEdit[]` (byte spans + replacements) or `null` to decline.
Must be **pure + deterministic** (no I/O, no time / random, no global
state) so the fixpoint loop + cache are reproducible. Function-form
edits apply only with `--unsafe`.

### `kind: 'guidance-only'` — surface, never apply

```ts
fix: { kind: 'guidance-only', safety: 'suggested', title: 'csharp.refactor', guidance: '...' }
```

No edit produced. The `title` + `guidance` land in the agent's
`suggested[]` block; the agent (or human) applies judgement. The only
valid kind for `safety: 'suggested'` without explicit `--unsafe`.

### Safety lanes

| `safety` | `regent fix` default | With `--unsafe` |
|----------|----------------------|-----------------|
| `'safe'` | auto-applies | auto-applies |
| `'suggested'` + `replace` / `delete-line` / `function` | surfaces in `suggested[]` | applies |
| `'suggested'` + `guidance-only` | surfaces in `suggested[]` | surfaces in `suggested[]` (never applies) |

Keep `safe` small and high-value (mechanically semantics-preserving
edits); prefer `suggested` for anything that wants a review pass.

### `converges?: boolean` — opt-in to the fixpoint loop

`converges: true` opts the rule into `applyFixes`'s re-scan: after
each pass, the engine re-detects the changed file and re-applies any
new findings whose rule also opted in. Default `false`. Mark `true`
ONLY for mechanically idempotent fixes (`delete-line`, fixed-template
`replace`); chained edits that re-trigger detection will loop until
`maxPasses` (default 5) is exhausted and `ApplyFixesConvergenceError`
fires.

The full long-form guide — templates, safety↔kind invariants, the
pure-deterministic contract, and how to add a `fixed.<ext>` to a
shipped fixture — lives in
[`CONTRIBUTING.md` "Authoring a fix"](CONTRIBUTING.md#authoring-a-fix).

## Agent workflow

```sh
# 1. Read user intent
# 2. Browse curated examples
regent llm examples <lang>

# 3. Author a rule OR copy one
regent example copy <lang> <rule-id>
# (or write tools/audit/rules/<rule-id>.lint.ts by hand)

# 4. Verify
regent check
regent fix --check
regent review

# 5. Iterate
```

## Logging

Operational logs go to **stderr** via `pino`. Findings / reports /
banners go to **stdout** (machine-readable data). Configure with:

- `--log-level` / `--log-format` CLI flags (highest precedence)
- `STBL_REGENT_LOG_LEVEL` / `STBL_REGENT_LOG_FORMAT` env vars
- `log.level` / `log.format` in your config

Levels: `trace | debug | info | warn | error | fatal`. Formats:
`text` (pino-pretty, TTY-friendly) or `json` (NDJSON for log
aggregators).

**Log hygiene:** `safeLog()` from the public API redacts `matchText`,
`pattern`, and `path` — these may contain secrets. Use `safeLog()` for
all custom log payloads; pino's redact covers the rest.

## Architecture

| File | Role |
|------|------|
| `src/types.ts` | `RuleSpec`, `Severity`, `ConfigLayer`, `Finding`, `ContextWindow` |
| `src/define-rule.ts` | legacy `defineRule` (alias for `defineDetectRule`) |
| `src/kinds/detect.ts` | `defineDetectRule` (`.lint.ts`) |
| `src/kinds/fix.ts` | `defineFixRule` (`.fix.ts`) |
| `src/kinds/index.ts` | public kind surface |
| `src/patterns/index.ts` | composable regex builders |
| `src/loader.ts` | discovery + applies disable/override/add/accept |
| `src/runner.ts` | per-file scan via `scanFile` (parallel) |
| `src/regex.ts` | RE2 wrapper over `re2-wasm` |
| `src/config/` | layered config: cosmiconfig + Zod + 5 sources |
| `src/logging/` | pino + safeLog + log levels |
| `src/core/cache.ts` | disk cache (`.regent/cache.json`, atomic, LRU) |
| `src/core/dag.ts` | cycle detection + topological sort |
| `src/core/benchmark.ts` | synthetic perf workload + baseline |
| `src/core/diff.ts` | unified diff for `regent fix --diff` |
| `src/core/scanner.ts` | Rust-ready `FileScanner` interface (TS impl) |
| `src/core/scanner-matcher.ts` | matcher algorithm (TS reference) |
| `src/reporter/text.ts` | picocolors-coloured, multi-line context |
| `src/reporter/sarif.ts` | SARIF 2.1 (`region` + `contextRegion`) |
| `src/reporter/review.ts` | pending / accepted markdown + JSON |
| `src/cli.ts` | commander: `check`, `fix`, `review`, `list`, `init`, `migrate`, `accept`, `reject`, `cache`, `example`, `benchmark`, `llm` |
| `src/llm.ts` | multi-page skill docs loader |
| `src/llm-router.ts` | `regent llm <subcommand>` router |
| `src/examples/index.ts` | shipped-example registry |
| `assets/llm/` | agent skill contract (markdown) |
| `examples/<lang>/*.lint.ts` | shipped rule packs (NOT auto-loaded) |

## Why `regent`?

- **Zero language bias.** No bundled C# / TS / Python rules. The
  agent picks what fits the project.
- **TS-first rule authoring.** Rules are TypeScript modules with
  type-safe `defineDetectRule` / `defineFixRule` helpers.
- **RE2 matching.** Linear-time, no ReDoS, no backreferences.
- **Agent contract.** `regent llm` exposes the full skill set as
  navigable markdown — agents self-discover without hand-feeding.
- **Cache + benchmark.** `.regent/cache.json` with version-stamp
  invalidation; `regent benchmark` measures perf and gates
  regressions in CI.

## Status

| | |
|---|---|
| Stage | v0.4.0 in development (fix-mode epic shipped) |
| Version | 0.4.0 |
| License | MIT |
| Runtime | Node ≥ 20 (Bun recommended for dev) |
| Regex | `re2-wasm` (linear-time, no ReDoS) |
| Test runner | vitest (555/555 as of last sync) |
| CI | GitHub Actions (typecheck + lint + test + benchmark gate) |
| Pattern helpers | 34 across C# / TypeScript / Python / Java / Go / Rust (see [`regent llm authoring detect`](assets/llm/authoring/detect.md#pre-built-composable-patterns)) |

## Brand

Brand assets are vendored via git submodule from
[dot-stbl/.github](https://github.com/dot-stbl/.github) at
`assets/stbl/`. To update: `git submodule update --remote assets/stbl`.
To modify the kit, open a PR at
[dot-stbl/.github](https://github.com/dot-stbl/.github).

## Related

- [`@dot-stbl` brand kit](https://github.com/dot-stbl/brand) —
  design rules, asset templates, contributing notes.
- [`@dot-stbl` org](https://github.com/dot-stbl) — sibling projects
  (`tessera`, `plexor`, `anlytra`, …).
- [`@dot-stbl/regent` repo](https://github.com/dot-stbl/regent) —
  issues, PRs, releases.

---

<sub><code>regent</code> is built by <a href="https://github.com/dot-stbl">.stbl</a>. — <code>[.stbl](feat/v0.2): multi-mode agent-first static analysis</code></sub>
