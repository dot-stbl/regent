# CLI reference

Binary: `regent` → `dist/cli.js` (package bin `@dot-stbl/regent`).

**Source of truth for flags:** the Commander definitions in `src/cli.ts` and `src/cli/*.ts`, and:

```sh
regent --help
regent <command> --help
```

This page summarizes purpose, important flags, examples, and known exit codes from the current tree. It is not a full flag dump.

## Version skew

| Source | Version (this tree) |
|--------|---------------------|
| `package.json` `"version"` | `0.5.2` |
| `src/cli.ts` `VERSION` (`.version()` / `--version`) | `0.3.0` (hardcoded; may lag package / npm) |
| npm `@latest` | often **ahead** of a local checkout |

`regent update` / startup check compare **installed package version** (via package resolution) to the registry, not necessarily the CLI `VERSION` string. Prefer `npm view @dot-stbl/regent version` for published truth.

Global options (on root program):

| Flag | Meaning |
|------|---------|
| `--log-level <level>` | `trace\|debug\|info\|warn\|error\|fatal` |
| `--log-format <fmt>` | `text\|json` |
| `-V, --version` | CLI version string |
| `-h, --help` | help |

Env: `STBL_REGENT_LOG_LEVEL`, `STBL_REGENT_LOG_FORMAT`. Default format is `text` on TTY, `json` when piped/CI.

---

## `regent check`

**Purpose:** Load rules, scan scope, print findings, set exit code.

| Flag | Default / notes |
|------|-----------------|
| `--config <path>` | `tools/audit/config.ts` |
| `--scope <dir>` | `.` |
| `--all` | scan all files (not only git-changed) |
| `--diff-base <ref>` | `HEAD` |
| `--format <fmt>` | `text` (`json`, `sarif`, `both` also handled) |
| `--out <file>` | write report instead of stdout |
| `--exit-on <severity>` | `error` — fail threshold |
| `--include-rules <patterns>` | comma-separated id patterns |
| `--exclude-rules <ids>` | comma-separated ids |
| `--severity <level>` | filter **display** only (not exit) |
| `--no-color` | disable ANSI |
| `--no-review` | hide pending review section |
| `--stream` | live text findings + progress |
| `--watch` | chokidar re-run (100 ms debounce); inner-loop only |
| `--columns <n>` | wrap width |
| `--concurrency <n>` | override runner concurrency |
| `--annotate-pr <num>` | post findings as PR review comments via `gh api` |

```sh
regent check
regent check --all --format json
regent check --exit-on warning --no-review
regent check --annotate-pr 42
```

**Exit codes (known):**

| Code | When |
|------|------|
| `0` | No failable findings at/above `--exit-on` |
| `1` | `status: violation` at/above threshold, or `pending` with `review.exitBehavior === 'unreviewed-fails'`; also rule-load failure |
| `2` | Annotate-PR misconfiguration (e.g. missing `gh`, bad PR number) — combined with base via `Math.max` |

`--severity` / `--no-review` change **stdout**, not the exit-code input set (full findings used).

**Side effects:** optional update hint on stderr; format/delegate autodetect hints; delegate tools after per-file scan.

---

## `regent fix`

**Purpose:** Detect + apply auto-fixes (`src/cli/fix.ts` → `applyFixes`).

| Flag | Notes |
|------|-------|
| `[paths...]` | optional path narrow (default cwd) |
| `--dry-run` | show changes; do not write |
| `--unsafe` | function-form + `safety: 'suggested'` |
| `--all` | **deprecated** alias of `--unsafe` |
| `--rule <id>` | repeatable literal rule ids |
| `--filter <glob>` | finding path filter |
| `--format text\|json` | default `text`; json = v1 wire doc |
| `--json` | **deprecated** → `--format json` |
| `--max-passes <n>` | fixpoint cap (default 5, max 20) |
| `-y, --yes` | skip confirmation |

```sh
regent fix --dry-run
regent fix --unsafe -y
regent fix src --rule csharp.no-region-directive --format json
```

**Exit codes (documented in `fix.ts`):**

| Code | When |
|------|------|
| `0` | Applied or only non-blocking deferred (e.g. no-fix-attached) |
| `1` | Overlap / out-of-range deferred, or fixpoint convergence error |

AST-only / transform findings are skipped in the detect step for this path (engine consumes regex `RuleSpec` + findings).

---

## `regent review`

**Purpose:** Surface **pending** review findings (markdown or json).

| Flag | Notes |
|------|-------|
| `--config`, `--scope` | as check |
| `--all` | full tree |
| `--format markdown\|json` | default `markdown` |
| `--include-accepted` | also list accepted (audit) |

```sh
regent review
regent review --format json --include-accepted
```

**Exit:** always `0` after a successful run (review is a report, not a gate).

---

## `regent list`

**Purpose:** Print every loaded rule id, severity, kind (`detect` / `ast` / `transform`), origin.

```sh
regent list
```

Options: `--config`, `--scope`. May print update warning on stderr.

---

## `regent bundles`

**Purpose:** List language parse bundles (id, pack, globs, grammar note, detected project version).

```sh
regent bundles
```

**Exit:** `0`.

---

## `regent init`

**Purpose:** Create `tools/audit/` scaffold (`config.ts`, `rules/`, `.gitignore`, `AGENT.md`).

```sh
regent init
```

**Exit:** fails if `tools/audit` already exists (`exitCode = 1`).

---

## `regent config`

**Purpose:** Inspect merged config (issue #15).

| Subcommand | Args | Output |
|------------|------|--------|
| (none) / `help` | | usage |
| `show` | `<field>` dotted path | value + layer origin |
| `diff` | | non-default overrides |
| `layers` | | layer list low→high |

```sh
regent config layers
regent config show runner.concurrency
regent config diff
```

**Exit:** `0` ok; `1` load/path errors; `2` bad usage.

---

## `regent migrate`

**Purpose:** Migrate legacy `tools/audit/config.{ts,js,…}` toward v0.2 `.regentrc.ts` shape.

```sh
regent migrate
```

**Exit:** `0` if nothing to migrate or migration completes (see implementation for write failures).

---

## `regent explain <rule-id>`

**Purpose:** Print message, source path, rationale, review guidance for one loaded rule.

```sh
regent explain csharp.no-todo-without-owner
```

**Exit:** sets `process.exitCode = 1` if rule not found.

---

## `regent accept <rule-id> <target>`

**Purpose:** Append accept-list entry (silence pending review).

| Arg / flag | Notes |
|------------|-------|
| `<target>` | `path` or `path:line` |
| `--reason <reason>` | **required**, max 500 chars |
| `--config <path>` | override file |
| `--scope` | write shared `config.ts` instead of `config.local.ts` |

```sh
regent accept csharp.no-todo-without-owner src/Foo.cs:42 --reason "tracked in ANL-200"
```

**Exit:** `0` ok; `1` write failure; `2` missing reason.

---

## `regent reject <rule-id> <path:line>`

**Purpose:** Record escalation in `tools/audit/.rejections.json`.

```sh
regent reject csharp.no-todo-without-owner src/Foo.cs:42
```

**Exit:** `0` ok; `2` if line missing from target.

---

## `regent describe [ruleId]`

**Purpose:** Parameterized rules only — list ids, or dump JSON Schema + sample `rules.configure`.

```sh
regent describe
regent describe csharp.max-line-length --format json
```

| Flag | Notes |
|------|-------|
| `--config`, `--scope` | load context |
| `--format text\|json` | default `text` |

**Exit:** `0` ok; `2` unknown rule id.

---

## `regent diff [baseline]`

**Purpose:** New vs resolved findings against a baseline; updates `.regent/diff-baseline.json`.

| Baseline | Behavior |
|----------|----------|
| omitted / `cached` | last cached JSON run |
| path / `path:…` | JSON run file |
| `git:…` | **not supported yet** (errors with pointer to issue #120) |

```sh
regent diff
regent diff path:.regent/last.json --format json
```

**Exit:** `0` on success; non-zero on bad format / missing baseline (stderr message).

---

## `regent update`

**Purpose:** Compare installed vs npm registry; print upgrade command for detected package manager.

```sh
regent update
```

Registry: `https://registry.npmjs.org/@dot-stbl/regent` (override `STBL_REGENT_REGISTRY`). Opt out of startup checks: `STBL_REGENT_NO_UPDATE_CHECK=1`.

**Exit:** non-zero when already up-to-date (implementation treats “no upgrade needed” as a distinct result — see `runUpdate`).

---

## `regent cache <action>`

| Action | Effect |
|--------|--------|
| `stats` | JSON path + stats |
| `clear` | delete `.regent/cache.json` if present |

```sh
regent cache stats
regent cache clear
```

**Exit:** `2` on unknown action.

---

## `regent example <action> [args...]`

| Action | Args | Effect |
|--------|------|--------|
| `list` | | `lang/ruleId` lines |
| `show` | `<lang> <rule-id>` | print example source |
| `copy` | `<lang> <rule-id> [target-dir]` | copy into `tools/audit/rules` (default) |

```sh
regent example list
regent example show csharp no-todo-without-owner
regent example copy typescript no-console
```

**Exit:** `2` on bad args / missing example.

---

## `regent benchmark`

**Purpose:** Synthetic scan perf (JSON result).

```sh
regent benchmark --files 100 --rules 20 --iterations 3
```

---

## `regent llm [sub...]`

**Purpose:** Print agent docs from `assets/llm/` (markdown) or JSON Schema for select schemas.

| Subpath | Content |
|---------|---------|
| (none) | `assets/llm/index.md` |
| `authoring` / `authoring detect` / `authoring fix` | authoring guides |
| `schema` | catalog of schemas |
| `schema fix` | **v1 fix OUTPUT** JSON Schema (`schema/fix-v1.json`) |
| `schema detect-rule` / `schema fix-rule` | rule-spec markdown (`--json` emits JSON Schema) |
| `schema detect` | alias of detect-rule |
| `examples` / `examples <lang>` / `examples <lang>.<rule>` | example prose |

```sh
regent llm
regent llm authoring detect
regent llm schema fix
regent llm schema detect-rule --json
regent llm examples csharp.no-region-directive
```

**Exit:** `0` ok; `2` bad route / invalid `--json` usage.

---

## Commands **not** in this tree

There is **no** `regent doctor` subcommand in `src/cli.ts` / `src/cli/*` at the time of writing. PR annotation is **`check --annotate-pr`**, not a top-level command.

If help text or issues mention additional commands, verify against `regent --help` on your installed build.

---

## Environment variables (selected)

| Variable | Role |
|----------|------|
| `STBL_REGENT_LOG_LEVEL` / `STBL_REGENT_LOG_FORMAT` | logging |
| `STBL_REGENT_RUNNER_CONCURRENCY` | concurrency |
| `STBL_REGENT_OUTPUT_CONTEXT_BUFFER` | finding context lines |
| `STBL_REGENT_GLOBAL_RULES_PATH` | override user-global rules root |
| `STBL_REGENT_NO_UPDATE_CHECK` | disable startup registry check |
| `STBL_REGENT_REGISTRY` | npm registry URL for updates |
| `STBL_REGENT_AUTODETECT=off` | suppress format/delegate hints on check |

Config env overlay uses the `STBL_REGENT_*` family more broadly — see `src/config/sources/env.ts` and `regent config layers`.

---

## Related

- [architecture.md](./architecture.md) — pipeline and modules  
- [migrating/README.md](./migrating/README.md) — layering with ESLint/Biome/Prettier  
- `assets/llm/index.md` — agent skill index (may lag CLI flag renames; trust `--help`)  
