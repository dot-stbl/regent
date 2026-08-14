# Static analysis (detect)

## Purpose

Run authored detect and AST rules over a repository scope, produce findings with stable identity (rule, path, span, severity, status), and report them for humans, CI, and agents. Zero rules are bundled; the project/user supplies rules.

## Requirements

- **REQ-SA-01** — The system SHALL discover rules from user-global paths (`~/.agents/rules` or `STBL_REGENT_GLOBAL_RULES_PATH`), project `tools/audit/rules/`, and inline/`extends` config, without auto-loading `examples/`.
- **REQ-SA-02** — Regex detect rules SHALL match with RE2 syntax only (no lookaround, no backreferences) and SHALL evaluate patterns per line.
- **REQ-SA-03** — AST rules SHALL parse via language packs (ast-grep) and report precise spans for structural matches.
- **REQ-SA-04** — Findings SHALL carry severity (`error` | `warning` | `suggestion`), message, optional source/rationale, and status (`violation` | `pending` | `accepted`).
- **REQ-SA-05** — Review-enabled rules SHALL emit `pending` findings that do not fail CI unless `exitBehavior` is `unreviewed-fails`.
- **REQ-SA-06** — `regent check` SHALL support machine-readable output formats including `json` and `sarif`, plus human `text`.
- **REQ-SA-07** — Exclude globs and named `@group` references SHALL suppress scanning of matched paths.
- **REQ-SA-08** — Disk cache (`.regent/cache.json`) MAY skip unchanged file/rule pairs when enabled; cache invalidation MUST respect rule/content hashes and TTL.

## Scenarios

### Clean scan with no rules

Given a repository with no rule files and empty `rules.detect`  
When the user runs `regent check`  
Then the system scans with zero rules and reports zero findings with exit success (subject to exit-on policy).

### Regex detect finding

Given a detect rule with a RE2 pattern matching a line in a scoped file  
When the user runs `regent check --all`  
Then a finding is reported with rule id, path, line span, message, and status `violation` (unless review is enabled).

### Invalid RE2 pattern

Given a rule whose `pattern` uses lookbehind  
When rules are loaded  
Then load fails with a clear RE2 compile error (no silent skip).

### SARIF for CI

Given findings from a check run  
When the user runs `regent check --format sarif`  
Then output is a SARIF 2.1 document suitable for code-scanning consumers.

### Exclude generated code

Given a rule with `excludePaths: ['@generated']` and a match only under `**/Generated/**`  
When check runs  
Then no finding is emitted for that path.
