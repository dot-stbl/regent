# regent — agent skill

`regent` is a multi-mode static analysis framework. Three rule kinds:

- **detect** (`.lint.ts`) — match → report (eslint-style)
- **fix** (`.fix.ts`) — match → string replace (prettier-lite)
- **transform** (`.transform.ts`) — programmatic rewrite (v0.3+)

Rules are TypeScript modules. The agent writes rules; regent runs them,
caches results, reports findings, and offers auto-fix.

## Primary commands

| Command | Purpose |
|---------|---------|
| `regent llm` | this index |
| `regent llm authoring detect` | how to write detect rules |
| `regent llm authoring fix` | how to write fix rules |
| `regent llm schema detect` | detect rule spec (markdown table) |
| `regent llm schema fix` | fix rule spec (markdown table) |
| `regent llm examples <lang>` | curated examples by language |
| `regent llm examples <lang>.<rule>` | one example in full |
| `regent check` | run all rules (read-only) |
| `regent fix --check` | verify fix would apply (exit 1 if diff) |
| `regent fix --write` | run + write changes |
| `regent review` | surface tri-state candidates |
| `regent accept <rule> <path>` | silence a pending finding (`--reason` required) |
| `regent init` | scaffold `tools/audit/` |
| `regent migrate` | convert legacy v0.1 config to v0.2 |
| `regent cache stats` | cache hit/miss/size |
| `regent cache clear` | wipe `.regent/cache.json` |
| `regent benchmark` | synthetic perf measurement |
| `regent example list` | shipped example index |
| `regent example copy <lang> <rule>` | copy an example into a project |
| `regent list` | every loaded rule + origin |
| `regent explain <rule-id>` | source path + rationale |

## Workflow for an agent

1. **Read user intent** — language + house rules.
2. `regent llm examples <lang>` — scan curated examples.
3. **Write** `<rule-id>.lint.ts` (or `.fix.ts`) into `tools/audit/rules/`
   OR via `regent example copy`.
4. `regent check` — iterate until clean.
5. Commit. (Do not auto-commit; let the human review.)

## What ships vs what's in scope

regent ships zero rules by default. Examples live in `examples/` and
are accessed via `regent llm examples <lang>` or
`regent example copy`. The user/agent always authors the rules for
their context.

## Key design constraints (memorise these)

- TS-first authoring surface — agents write `.lint.ts` / `.fix.ts`
  files. No YAML/JSON config in v0.2.
- RE2 syntax only — no backreferences, no lookbehind, no lookaround.
  Use `excludeWhen` (positive match inversion) for "X but not Y".
- Per-line patterns — multi-line regex not supported. Compose
  per-line patterns + use `excludeWhen` for context.
- Idempotency contract on fix rules — applying once must produce a
  string that no longer matches `find`, otherwise `--check` reports
  diff every run.
- `STBL_REGENT_*` env vars for config (org-branded, tool-namespaced).
  `.regentrc.{ts,js,yaml,json}` for project config (via cosmiconfig,
  walks up).
- Log hygiene — never log `matchText`, `pattern`, or `path` to stderr.
  Use `safeLog()` from the public API.

## Failure modes you'll encounter

- **RE2 pattern rejected** — `re2-wasm` throws at compile. RE2 has
  no `(?=...)`, no `(?<=...)`, no `\\1`. Use `excludeWhen` instead.
- **config validation failed** — Zod strict mode. Unknown field
  → fail-fast at load. Re-read the schema.
- **dependency cycle detected** — DAG. Use `topologicalSort` /
  `detectCycles` to debug.
- **cache corrupted** — `regent cache clear`. Cache has a
  `schemaVersion` header; bumps invalidate automatically.
- **`@group` unknown** — declare it under `excludeGroups` in your
  config, or fix the typo.
