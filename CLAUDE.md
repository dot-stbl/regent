# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@dot-stbl/regent` is a grep/regex-based static-analysis CLI. It loads user-authored
rule files (`*.lint.ts` paired with sibling `*.md` prose), scans git-changed files
line-by-line with **RE2** (linear-time, ReDoS-safe), and reports violations as styled
text or **SARIF 2.1**. It covers rules that Roslyn/ESLint analyzers can't easily express
(cross-file grep conventions, project-shape invariants) and lets rules live next to the
prose that explains them.

The published binary is `regent` (`bin` → `dist/cli.js`). ESM only (`"type": "module"`),
Node ≥ 20, but the toolchain is **Bun** in practice (CI + docs use `bun`/`bunx`).

### Product intent (why the design looks like this)

The goal is an **analyzer + linter + formatter for any language, built for agentic
development** — a gap the author hit repeatedly on real projects: Roslyn/C# analyzers are
built for IDEs not agents, linters are inconsistent across languages, Prettier-style
formatters exist only for a few ecosystems. `regent` aims to be the one agent-facing tool
that works everywhere.

Two principles follow from that and should be treated as **intentional, not gaps**:

- **No bundled rule packs.** `regent` ships zero built-in rules on purpose. Every team
  brings its own idea of what its code should look like; the tool is the engine, the rules
  are the user's. Don't "fix" this by adding default rule sets.
- **Agent-first, not IDE-first.** Machine-readable provenance, `regent llm` / `--llm`,
  SARIF, and the tri-state review flow all exist so an LLM agent can read, triage, and act
  on findings — that is the product's differentiator, not the regex engine.

Multi-mode (`.lint.ts` detect / `.fix.ts` fix / `.transform.ts` format) is the roadmap;
only detect (`.lint.ts`) is implemented today.

## Operating rules (global, always-on — you must obey these while working here)

This repo is the enforcer for a set of `always: true` global rules in
`~/.agents/rules/`. They are auto-loaded into every session and apply to your own actions,
not just to code you scan. **This project routinely handles secrets and API keys**, so the
secrets rule is load-bearing. The critical ones:

- **Secrets (`~/.agents/rules/secrets.md`).** Never `cat`, `echo`, `printenv`, or print a
  secret value — not even a prefix like `sk-…`. Never write a secret into chat, a commit
  message, PR/issue body, log, or a repo file. The user's secret store is `~/.secrets/`
  (`tokens/<svc>.env`, `oauth/<svc>.json`, `ssh/<name>/`, all `0600`); public keys
  (`*.pub`) are safe to show. If a secret appears in chat, don't echo it back, use it only
  via env vars, and recommend rotation. Recognized-token patterns (GitHub PAT, `sk-ant-…`,
  AWS `AKIA…`, npm `npm_…`, etc.) are listed in the rule.
- **Config secrets (`~/.agents/rules/csharp/configuration-toml-env.md`).** Secrets live in
  env vars only — never in `app.toml`, `appsettings*.json`, or any committed file. Env
  overrides use `PREFIX_SECTION__KEY` (double-underscore nesting).
- **Runtime safety (`~/.agents/rules/process/agent-runtime-safety.md`).** Never start
  long-lived processes (dev server, `--watch`, `serve`, `bun --hot`, `dotnet run/watch`).
  Never blanket-kill (`taskkill //IM node.exe`, `pkill node/bun`) — it can kill the agent
  harness itself. Browser automation (Playwright/Puppeteer/Chromium, screenshots) is a
  hard ban; debug visually via static analysis only. Build/lint/single-run tests are fine
  (`bun run build`, `vitest run`, `bun test`) — that's why the test scripts are run-once.

When editing rule-format or example content, `~/.agents/rules/csharp/rules-format.md` and
the other files under `~/.agents/rules/` are the canonical spec for how a rule's `.md` +
executable pair is expected to look — regent's job is to make those runnable.

## Commands

```sh
bun run build        # tsc → dist/  (must run before smoke/CLI use)
bun run typecheck    # tsc --noEmit
bun run lint         # eslint . --max-warnings 0
bun run test         # vitest run   (all tests)
bun run test:watch   # vitest watch
bun run smoke        # build + node dist/cli.js check --help

# Run a single test file / single test
bunx vitest run test/loader.test.ts
bunx vitest run test/loader.test.ts -t "name of the test"
```

**CI runs `bun test`, not `bun run test`** (see `.github/workflows/ci.yml`). `bun test`
invokes Bun's own Jest-style runner over `test/**/*.test.ts`; `bun run test` invokes
vitest. They are different runners over the same files — if you add tests, keep them
compatible with both, and reproduce CI failures with `bun test` specifically.

Dogfooding: after `bun run build`, `node dist/cli.js check --all` should pass inside this
repo (the tool lints itself; see the CONTRIBUTING PR checklist).

## Architecture

Pipeline, in dependency order — `loader → runner → reporter`, wired by the CLI:

- **`src/types.ts`** — the shared vocabulary. `RuleSpec`, `Severity`, `ConfigLayer`,
  `AcceptEntry`, `CompiledRule`, `Finding` (+ `FindingStatus` tri-state). Read this first;
  everything else is defined in terms of these.
- **`src/define-rule.ts`** — `defineRule()` / `defineConfig()`. Identity functions that
  `Object.freeze` and preserve `const` literal narrowing. No runtime behavior beyond that.
- **`src/loader.ts`** — layered rule discovery + merge (see "Rule discovery" below).
  Imports `.lint.ts`/`.rule.ts` modules dynamically, derives each rule's `source` from its
  sibling `.md`, applies `add`/`disable`/`override` from configs, accumulates the accept-list.
  Does **not** execute rules.
- **`src/regex.ts`** — thin wrapper over `re2-wasm`. `compileRegex` (probes for the RE2
  constructor across export shapes), `extractContext` (byte-offset → line window),
  `locationAt`. RE2 syntax: **no backreferences, no lookahead/lookbehind**.
- **`src/runner.ts`** — the actual scan. Collects files (git-changed via `simple-git`, or
  all files with `--all`), reads each (1MB cap), scans **line-by-line** against each rule's
  compiled pattern (+ optional `excludeWhen`), builds a context window (`±3` lines,
  `DEFAULT_CONTEXT_BUFFER` in `constants.ts`), and assigns each finding a tri-state `status`.
- **`src/reporter/text.ts`** — picocolors terminal output + summary line.
  **`src/reporter/sarif.ts`** — SARIF 2.1 (`region` + `contextRegion`) for GitHub code
  scanning. **`src/reporter/review.ts`** — `renderReview` (markdown) / `renderReviewJson`
  for the LLM-triage list.
- **`src/cli.ts`** — commander wiring. Subcommands: `check`, `review`, `list`, `init`,
  `explain`, `accept`, `reject`, `llm`. `src/cli/banner.ts` renders the ASCII header;
  `src/llm.ts` loads `assets/llm.txt` for `regent llm` / `--llm`.
- **`src/index.ts`** — the library's public export surface.

### Rule discovery (the mental model that spans files)

`regent` ships **zero built-in rules** as of v0.2. Rules come only from layers, merged
**top-wins by first-seen id** (a rule id already in the set is not overwritten):

1. **User-global** — `$HOME/.agents/rules/**/*.{lint,rule}.ts` (auto-loaded, recursive)
2. **Repo** — `<repo>/tools/audit/rules/*.{lint,rule}.ts` + `config.ts` (`extends`, `add`,
   `disable`, `override`, `accept`)
3. **Per-dev** — `<repo>/tools/audit/config.local.ts` (gitignored; layers `disable`/
   `override`/`accept` on top)

`config.ts` `extends` accepts file paths, directories, or globs pointing at rule files —
**not** `@dot-stbl/regent/presets/*` (those were removed in v0.2 and the loader now throws
a clear error if you reference them).

### Tri-state review (spans types.ts, runner.ts, cli.ts, reporter/review.ts)

A rule with `review.enabled` produces `pending` findings instead of `violation`s. Pending
findings show in a separate section and don't fail CI by default. Triage:

- `regent accept <id> <path>[:<line>] --reason "..."` → writes an `AcceptEntry` to a config
  (default `config.local.ts`; `--scope` targets committed `config.ts`). Matching findings
  become `accepted` (filtered out). Reason is mandatory (audit trail).
- `regent reject <id> <path>:<line>` → appends to `tools/audit/.rejections.json`.
- `review.exitBehavior: 'unreviewed-fails'` makes unaccepted pending findings fail CI;
  `'no-fail'` (default) never does.

The accept-list only silences **review-rule** findings — it does not affect plain
`violation`s (see `findAcceptMatch` guard in `runner.ts`).

## Conventions & gotchas

- **`.lint.ts` is the current extension; `.rule.ts` is legacy.** The loader accepts both.
  This is a v0.2 rename toward multi-mode rules (`.lint.ts` = detect; `.fix.ts` /
  `.transform.ts` are planned, not yet implemented). New rules use `.lint.ts`.
- **`examples/` rules are NOT auto-loaded.** They're public samples (each an `.lint.ts` +
  `.md` + `__fixtures__/{good,bad}.cs`). The fixture tests import them directly. Users are
  meant to copy them into their own rule dirs.
- **The README describes the old v0.1 architecture** (built-in C# presets as "Layer 1",
  4 layers, `.rule.ts`). The code is v0.2 (zero presets, 3 active layers, `.lint.ts`).
  Trust the code over the README; the README lags.
- **Version is inconsistent:** `package.json` is `0.2.0`, but `VERSION` in `src/cli.ts`
  and the README still say `0.1.0`. Bump `src/cli.ts` when you touch versioning.
- **Some CLI help text references unimplemented commands** — `regent init` and loader
  errors mention `regent llm examples <lang>` and `regent example copy <lang> <id>`, which
  don't exist yet (only bare `regent llm` is wired). Don't assume they work.
- **Every new rule needs a positive AND negative fixture** (`bad.<ext>` matches,
  `good.<ext>` doesn't). PRs without fixtures are rejected (CONTRIBUTING.md).
- **Windows path handling:** the runner normalizes `\` → `/` before glob/accept matching
  (`globMatches`, `findAcceptMatch`). Preserve this when touching path logic — tests and
  users run on Windows.
- **Patterns are per-line.** The runner scans line-by-line; multi-line patterns are not
  supported. Compose per-line patterns and use `excludeWhen` for "match X but not when Y"
  (RE2 has no lookahead).
- **TypeScript is strict** (`noUncheckedIndexedAccess`, `noImplicitOverride`, etc.).
  `tsconfig.json` compiles `src/` only; tests are excluded from the build.

## Brand assets

`assets/stbl/` is a git submodule of `dot-stbl/.github`. Update with
`git submodule update --remote assets/stbl`. Modify the kit itself via a PR on that repo,
not here. Release publishing goes to npmjs.com via `.github/workflows/release.yml`
on a `v*` tag.
