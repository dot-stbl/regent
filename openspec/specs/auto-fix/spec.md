# Auto-fix

## Purpose

Apply optional fix attachments on detect rules (and standalone fix rules / format specs) so agents and CI can rewrite sources safely: deterministic safe edits by default, suggested edits only with explicit opt-in, and a machine-readable applied/suggested/deferred report.

## Requirements

- **REQ-AF-01** — A detect rule MAY attach a `RuleFixSpec` with kind `replace` | `delete-line` | `function` | `guidance-only` and safety `safe` | `suggested`.
- **REQ-AF-02** — `safety: 'safe'` MUST NOT be paired with `kind: 'guidance-only'`; the loader MUST reject that combination.
- **REQ-AF-03** — `regent fix` without `--unsafe` SHALL apply only the safe lane of concrete edits; suggested concrete edits and guidance-only SHALL appear as suggested (not written), unless the library caller selects lane `all`.
- **REQ-AF-04** — `regent fix --unsafe` SHALL enable applying `function`-kind and `safety: 'suggested'` concrete edits; guidance-only MUST still never auto-apply.
- **REQ-AF-05** — `function` apply handlers MUST be pure and deterministic; returning `null` declines; throwing MUST not crash the whole run (rule edits dropped with a warning).
- **REQ-AF-06** — Rules with `converges: true` MAY participate in a fixpoint re-scan up to `--max-passes` (default 5, hard cap 20); exceeding the cap MUST surface a convergence error and non-zero exit.
- **REQ-AF-07** — `regent fix --format json` SHALL emit a v1 document with exactly three top-level keys: `applied`, `suggested`, `deferred` (schema `assets/llm/schema/fix-v1.json`).
- **REQ-AF-08** — Non-interactive runs MUST use `-y` / `--yes` (or dry-run) so confirmation does not hang agents; stdin without TTY without `--yes` MUST fail with a clear prompt error.
- **REQ-AF-09** — Overlapping edits on the same byte span and out-of-range offsets SHALL be deferred with stable reason tokens; overlapping / out-of-range SHALL contribute to exit code 1.
- **REQ-AF-10** — Standalone `.fix.ts` / `defineFixRule` rules SHALL perform string replace with an idempotency expectation (re-applying does not re-match `find`).

## Scenarios

### Safe replace without opt-in

Given a detect rule with `fix: { kind: 'replace', safety: 'safe', template: '' }`  
When the agent runs `regent fix --yes`  
Then matching substrings are rewritten on disk and listed under `applied` when using `--format json`.

### Suggested edit needs --unsafe

Given a rule with `safety: 'suggested'` and a concrete replace  
When the agent runs `regent fix --yes` without `--unsafe`  
Then the edit appears under `suggested` and the file is not changed for that edit.

### Guidance-only never writes

Given `fix: { kind: 'guidance-only', safety: 'suggested', title: '…', guidance: '…' }`  
When the agent runs `regent fix --yes --unsafe --format json`  
Then the item remains in `suggested` with `proposedEdit: null` and no disk write for that rule.

### Dry-run

Given fixable findings  
When the agent runs `regent fix --dry-run`  
Then no files are written and the report describes would-be changes.

### Fixpoint for converging delete-line

Given two rules with `converges: true` that chain-clean a file  
When `regent fix --yes --max-passes 5` runs  
Then successive passes re-detect and apply until stable or max passes.
