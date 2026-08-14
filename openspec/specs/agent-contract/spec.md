# Agent contract

## Purpose

Expose regent to LLM coding agents as a self-describing skill: navigable authoring docs, machine-readable check/fix outputs, log hygiene that avoids leaking match content, and a clear decision boundary vs native formatters/analyzers.

## Requirements

- **REQ-AC-01** — `regent llm` SHALL serve multi-page markdown from `assets/llm/` covering index, authoring (detect/fix), schemas, and examples by language.
- **REQ-AC-02** — Agents MUST be able to author or copy rules into project scope (`tools/audit/rules/` or config inline) without regent shipping mandatory product rules.
- **REQ-AC-03** — `regent check --format json` SHALL emit a stable finding document suitable for programmatic triage (ruleId, path, span, status, message, context).
- **REQ-AC-04** — `regent fix --format json` SHALL emit the frozen v1 fix document (`applied` / `suggested` / `deferred`) documented by `assets/llm/schema/fix-v1.json`.
- **REQ-AC-05** — Operational logging SHALL redact `matchText`, `pattern`, and `path` when using `safeLog` / `safeLogPayload`; findings remain on stdout for agents that need match text.
- **REQ-AC-06** — The Agent Skill at `skills/regent` (and user install under `~/.agents/skills/regent`) SHALL instruct: prefer native tools, then regent AST, then regent regex; use `regent check` as the single quality entry point.
- **REQ-AC-07** — Agents SHOULD NOT auto-commit after fix/check; human review remains the default unless the user explicitly requests commit.
- **REQ-AC-08** — Non-interactive fix application MUST use `--yes` (and `--unsafe` when suggested/function fixes are required).

## Scenarios

### Self-discovery

Given a fresh agent session with regent on PATH  
When the agent runs `regent llm` then `regent llm examples typescript`  
Then it receives authoring indexes and can copy or hand-write a rule without external docs.

### Programmatic check loop

Given project rules that fire on a source file  
When the agent runs `regent check --format json`  
Then it can parse findings, edit sources, and re-run until findings clear or are accepted.

### Fix JSON for judgement

Given mixed safe and suggested fixes  
When the agent runs `regent fix --yes --format json`  
Then it applies safe edits and receives `suggested[]` items with guidance and optional `proposedEdit` for per-item decisions.

### Log hygiene

Given a finding whose match line contains a secret-looking token  
When the engine logs via `safeLog` with a payload containing `matchText`  
Then the log field is replaced with `<redacted>` while the check JSON may still include match text for the agent consumer.

### Native vs regent decision

Given a request to “enforce prettier formatting”  
When the agent follows the skill  
Then it configures a format/delegate wrapper or runs prettier, and does not reimplement prettier as a regent regex rule.
