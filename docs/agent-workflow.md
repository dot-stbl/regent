# Agent workflow

How an LLM coding agent should use `@dot-stbl/regent`. Human short form also lives in the root README “Agent workflow” section; this page is the operational contract.

---

## Intended loop

```
1. Read intent          → language + house rules (project .md / AGENTS / chat)
2. regent llm …        → authoring + examples + schemas
3. Author or copy rule  → tools/audit/rules/*.lint.ts  (or example copy)
4. regent check         → iterate until findings match intent
5. regent fix …         → apply safe / suggested lanes as appropriate
6. regent review/accept → tri-state pending findings
7. Human review         → do not auto-commit unless the user asks
```

Concrete commands:

```sh
# Skill index + authoring
regent llm
regent llm authoring detect
regent llm authoring fix
regent llm schema detect
regent llm schema fix
regent llm examples csharp
regent llm examples csharp.async.configure-await

# Scaffold (once per repo)
regent init

# Copy a shipped template
regent example copy csharp no-todo-without-owner

# Detect
regent check
regent check --all --format json
regent check --format sarif --out findings.sarif

# Fix (see flags below)
regent fix --dry-run
regent fix --yes
regent fix --yes --unsafe
regent fix --format json --yes

# Review
regent review
regent accept <rule-id> <path> --reason "…"
```

---

## Machine-readable outputs

### `regent check --format json`

Agent-friendly document: `rules[]`, `findings[]`, `scannedFiles`. Each finding includes `ruleId`, `severity`, `path` (repo-relative, `/` separators), `match` (1-indexed line/column + text), `context`, `message`, `source`, `status` (`violation` | `pending` | `accepted`).

Implementation: `src/reporter/json.ts`.

### `regent check --format sarif`

SARIF 2.1 for CI / code scanning (`src/reporter/sarif.ts`). Default CLI format is `text`.

### `regent fix --format json` (v1)

Wire document with **exactly three** top-level keys (frozen schema: `assets/llm/schema/fix-v1.json`):

| Key | Meaning |
|-----|---------|
| `applied` | Edits written to disk (safe lane / applied under `--unsafe`) |
| `suggested` | Not applied: `safety: 'suggested'` or `guidance-only`; agent judges per item (`proposedEdit` may be `null`) |
| `deferred` | Unresolved: `overlap with <ruleId>`, `out-of-range`, `no-fix-attached` |

Fetch schema text: `regent llm schema fix` (and related schema pages under `assets/llm/schema/`).

Types: `src/reporter/fix-schema.ts` (`FixV1Document`).

### Fix CLI flags (source of truth: `src/cli/fix.ts`)

| Flag | Role |
|------|------|
| `--dry-run` | Show changes; do not write |
| `--unsafe` | Apply `function`-kind and `safety: 'suggested'` concrete edits |
| `--all` | **Deprecated** alias for `--unsafe` |
| `--rule <id>` | Restrict rule ids (repeatable) |
| `--filter <glob>` | Restrict finding paths |
| `--format text\|json` | Output format (default text) |
| `--json` | **Deprecated** alias for `--format json` |
| `--max-passes <n>` | Fixpoint cap for `converges: true` (default 5, max 20) |
| `-y`, `--yes` | Skip interactive confirmation (required in non-interactive agents) |

**Note:** Root README quickstart may still show `regent fix --write` / `regent fix --check`. The implemented mutator is **`regent fix` with optional `--dry-run`**; confirmation is skipped with **`--yes`**. Prefer those flags in agent scripts. There is no separate `--write` flag in the current CLI.

Exit: `0` when applied/suggested only; `1` on overlapping / out-of-range deferred edits or fixpoint exhaustion. `no-fix-attached` deferred does not force exit 1 by itself.

---

## `regent llm` surface

| Subcommand | Purpose |
|------------|---------|
| `regent llm` | Skill index (`assets/llm/index.md`) |
| `regent llm authoring detect` | Detect authoring guide |
| `regent llm authoring fix` | Fix / `RuleFixSpec` guide |
| `regent llm schema detect` | Detect field table (+ JSON schema page) |
| `regent llm schema fix` | Fix rule schema / fix-v1 output schema |
| `regent llm examples <lang>` | Language example index |
| `regent llm examples <lang>.<rule>` | One example full page |

Related non-llm commands agents use often: `regent list`, `regent explain <id>`, `regent describe <id>`, `regent example list|copy`, `regent cache stats|clear`, `regent config` (when available).

---

## Log hygiene (`safeLog`)

Operational logs go to **stderr** (pino). Findings and fix JSON go to **stdout**.

**Never log raw secrets-prone fields.** `safeLog` / `safeLogPayload` (`src/logging/levels.ts`) redact:

- `matchText`
- `pattern`
- `path`

Redacted values become `'<redacted>'` (not silent drop). Prefer `safeLog(logger, level, payload, msg)` for custom payloads. Configure level/format via `STBL_REGENT_LOG_*`, config `log.*`, or CLI `--log-level` / `--log-format`.

---

## Skill install locations

| Location | Role |
|----------|------|
| `skills/regent/SKILL.md` (in this repo) | Canonical Agent Skill for Claude / opencode / similar |
| `~/.agents/skills/regent/SKILL.md` | User-global skill install (same content when installed for agents) |

The skill encodes: prefer native tools → regent AST → regent regex; run quality through `regent check` as the single entry point.

---

## Decision: native tool vs regent rule

Do **not** reimplement formatters/analyzers that already exist.

1. **Native first** — `dotnet format`, Roslyn + `.editorconfig`, prettier, eslint, ruff, gofmt, rustfmt, clippy, …
2. **regent AST** — project house rules with no native analyzer (cheap vs custom Roslyn/ESLint plugin).
3. **regent regex detect** — text-only conventions (TODO owner, trailing whitespace).

Register natives as **format** / **delegate** rules so agents still run one command. See [rules.md](./rules.md#decision-native-tool-vs-regent-rule) and `skills/regent/SKILL.md`.

---

## Review / accept loop

Rules with `review.enabled` emit `pending` findings. They do not fail CI unless `review.exitBehavior: 'unreviewed-fails'`.

```sh
regent review
regent accept <rule-id> <path> --reason "legacy; tracked in TICKET-1"
```

`--reason` is required (max 500 chars). Accept list lives in config layers (`rules.accept[]` / legacy `tools/audit/config*.ts`).

---

## Related

- [Rule authoring](./rules.md)
- [Configuration](./config.md)
- OpenSpec: `openspec/specs/agent-contract/spec.md`
- Assets: `assets/llm/`, `assets/llm/schema/fix-v1.json`
