# ADR-0001: Regent positioning — bridge, not linter

- **Status:** Accepted
- **Date:** 2026-07-23
- **Supersedes:** _none_
- **Related:** [`~/.agents/skills/regent/SKILL.md`](../../../.agents/skills/regent/SKILL.md) (the agent-facing skill), `README.md`, [issue #86](#86) (dogfooding policy), [issue #57 sub-item 2](#57) (regex deprecation timeline)

## Context

regent started as a "house-rule linter for C# projects" — a tree-sitter-backed
checker the agent invokes to enforce project-specific conventions. After ~6 months
of agent-driven development and a long backlog (100+ issues), the project's role
in the ecosystem has drifted and is no longer self-evident. The maintainer's
2026-07-23 read of the situation:

> I've used regent in the background for a long time, and it kind of works, but
> I don't fully know what's in it anymore. The agent loop is: human spots a
> piece of bad code → asks the agent to fix it → agent picks **something**. What
> regent should do is **not** be the linter. It should be the thing that tells
> the agent: "use `dotnet format` + Roslyn for this; reach for a regent rule
> only for this; here's the exact house-rule."

Three signals that the prior framing (regent = linter) is wrong:

1. **Re-implementation tax.** A surprising amount of regent's surface (formatting
   checks, naming conventions, nullability) duplicates what every ecosystem's
   native tooling already does. Each re-implementation is a maintenance burden
   that lags the upstream by months. The team has caught `csharp.format.*`
   rules that were literally worse than `dotnet format` on the same input.

2. **The `regent llm` command is the most-used entry point**, but it's not a
   linter — it's a **publisher of agent-facing skill documentation**. That
   command is regent's actual product; the checker is one consumer of it.

3. **The agent already has to choose** between `prettier`, `eslint`,
   `dotnet format`, `ruff`, `gofmt`, `clippy`, etc. Without regent telling it
   which to pick, the agent re-derives the answer on every task — slowly,
   inconsistently, and often wrong.

## Decision

regent is **a bridge + skill publisher**, not a standalone linter. It encodes
two responsibilities:

1. **Skill publisher for agents** — the `regent llm` subcommand publishes
   machine-readable guidance on what to use when. The agent invokes
   `regent llm` (or reads the published skill via standard agent skill
   discovery, `~/.agents/skills/regent/SKILL.md`) and learns which native tool
   already covers each convention, plus the project's own house-rules in
   `tools/audit/rules/`.

2. **Bridge for the gap** — regent runs **only** the rules that the
   ecosystem doesn't already cover (project-specific house-rules, structural
   conventions the native tool can't express). It delegates everything else to
   the native tool.

The runtime hierarchy, fixed by this ADR:

```
┌──────────────────────────────────────────────────────────┐
│  Agent                                                    │
│   │  ask: "what enforces convention X in <lang>?"          │
│   ▼                                                        │
│  regent llm  (or  ~/.agents/skills/regent/SKILL.md)        │
│   │  publishes: "use <native tool> for X"                  │
│   │  publishes: "use regent ast rule for Y"                │
│   ▼                                                        │
│  one of:                                                   │
│   • Native tool (prettier, eslint, dotnet format,         │
│     ruff, gofmt, clippy, Roslyn, …)                        │
│   • regent ast rule (house-rule only)                      │
└──────────────────────────────────────────────────────────┘
```

### Concrete rules

1. **Native first.** Before authoring a regent rule, decide if a native tool
   covers it. Author a regent rule only when the answer is **no**. This is the
   same hierarchy the agent skill encodes (`native > regent ast > regent regex`).

2. **One command for the agent.** The agent runs `regent check` (and only
   `regent check`) regardless of which rule layer fired. Native tools are
   invoked under the hood by regent's delegate mode; their results come back
   normalized into the same finding shape as regent-native rules.

3. **Regent rules are house-rules, not general-purpose style.** A regent rule
   answers a question like "does **this** repo ban `process.exit` outside
   `src/cli/**`?" — not "is this code formatted correctly?" The latter is
   `dotnet format`'s job; the former is regent's.

4. **`regent llm` is the canonical interface for agents.** Skill
   documentation — `~/.agents/skills/regent/SKILL.md` — must be kept in sync
   with `regent llm` output. Both surfaces describe the same decision tree.

5. **The dogfooding policy (issue #86) is the test.** `tools/audit/rules/`
   in this repo contains only regent rules that **don't duplicate** what
   `bun run lint` / TypeScript's native toolchain already enforce. New
   additions that overlap with native tooling are rejected in review.

6. **Regex rules are deprecated** (issue #57 sub-item 2). They remain for
   purely textual conventions with no structure (commit-message format,
   TODO-owner markers), but every regent rule that *could* be `ast` is
   migrated to `ast`. Timeline: v0.4 warn, v0.5 stop defaulting to regex in
   `regent init`, v0.6 remove the kind.

### Out of scope

- Replacing native tools. Regent doesn't ship its own formatter, type-checker,
  or language server. It orchestrates them.
- A plugin marketplace / cross-repo rule sharing. Today's distribution is
  user-global (`~/.agents/rules/`) + per-repo (`tools/audit/rules/`) +
  inline config. That's enough.
- Removing the runtime checker. It stays; it's the only way `regent llm` can
  point the agent at a real, executable artefact.

## Consequences

### Positive

- **No more re-implementation tax.** Anything `dotnet format` /
  `prettier` / `clippy` already does, regent delegates. Maintenance shifts
  from "regent reimplements prettier" to "regent delegates prettier correctly."
- **One entry point for agents.** The agent learns **one** command
  (`regent check`) and **one** skill (`~/.agents/skills/regent/SKILL.md`).
  It does not need to memorise five CLIs.
- **Regent rules stay small and project-shaped.** A house-rule base that
  tries to be prettier will always lose. A house-rule base that says "no
  `process.exit` in lib code" is something only regent can express.
- **The backlog stops growing from duplicate work.** Anything the user
  wanted to add that overlaps with native tooling gets rejected at the
  issue-triage step with "use `<native tool>` instead."

### Negative

- **Users who relied on regent-as-linter have to migrate.** Any project
  using `tools/audit/rules/csharp.format.*` needs to switch to
  `dotnet format` + Roslyn. The CHANGELOG must call this out at every
  release.
- **Delegate mode becomes load-bearing.** If regent's wrapper around
  `prettier`/`eslint`/etc. breaks, the user loses a tool — not a regent
  feature. Delegate-mode stability becomes a release-blocker.
- **The skill publication surface must stay narrow.** `regent llm` is
  load-bearing for agent behaviour; drift between the live tool output and
  the skill file creates silent inconsistency.

### Neutral

- **The 100-issue backlog splits naturally now.** Issues about "add a rule
  that prettier already covers" → close as wontfix (use prettier). Issues
  about "regent can't tell X" → ship. Issues about "dogfood regent on a
  real project" → test the bridge in production.
- **The naming is fine as-is.** "regent" doesn't promise to be a linter; it
  just happens to have started that way. A future rename is a separate
  conversation.

## Alternatives considered

### A. Regent as a standalone linter (the original framing)

Status quo. Reasons rejected:

- The agent still has to know prettier / eslint / dotnet format etc. The
  "one command" promise was always a lie.
- Maintenance cost is unbounded as native tools improve.
- The skill-publisher role (`regent llm`) doesn't fit "standalone linter" —
  it's a coordination concern.

### B. Regent as a pure skill publisher (no runtime)

Regent becomes a documentation tool only; the agent picks native tools based
on the skill text and runs them directly. Reasons rejected:

- Loses the executable reference: the agent can't verify a convention is
  actually enforced.
- Loses the dogfooding story (regent can't lint itself).
- House-rules still need *something* to execute them. That something is
  either regent (current) or a custom per-project script (regression).

### C. Regent as a thin wrapper over a single native tool (e.g. eslint plugin)

Regent becomes an eslint plugin, or a ruff plugin, etc. Reasons rejected:

- Loses cross-language coverage (the project's value is the
  one-entry-point-across-languages story).
- Couples to one tool's API surface. The bridge story only works because
  regent owns the wrapper.
- The .stbl user base works in C#, TypeScript, Go, Python, Rust. Picking
  one ecosystem as the host kills the others.

## Validation

This ADR's success criterion is observable:

1. **Skill drift is zero.** `regent llm` output and `~/.agents/skills/regent/SKILL.md`
   agree on the native-vs-regent decision tree. Test: a CI step that diffs
   the rendered skill doc against `regent llm` output.
2. **Dogfooding rules don't overlap with native tooling.** `tools/audit/rules/`
   contains no rule that `eslint`, `prettier`, or `bun run lint` would
   already catch.
3. **Real-project validation.** Pick a `.stbl` user project (separate ADR
   once chosen) and run `regent check` against it; the report should show
   only house-rule findings, with native-tool findings delegated + surfaced
   under the same envelope.
4. **Backlog hygiene.** Issues proposing rules that duplicate native tooling
   are closed as `wontfix: use <native tool>` within one triage cycle.
