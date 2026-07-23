# code-style-shaping — interactive style audit for any codebase

> Companion to `code-review`: `code-review` checks a diff;
> `code-style-shaping` defines what to check.
> Born from the 2026-07 plexor dogfood (`dot-stbl/regent#110`).

## When to use

- A codebase has style drift and you want a current picture of what rules
  apply vs what the docs say vs what's enforced.
- Onboarding a new agent and want to capture "what good looks like" in
  10–20 snippets, not a 200-file read.
- PR review found N issues; you want to scale the verdict into something
  the agent will follow.

## When NOT to use

- The codebase has zero rules yet — write the obvious 5–10 rules first.
- You want a one-shot audit of a PR → use `code-review`.
- You want to refactor specific code without touching rules → just edit.

## Workflow

The skill runs interactively. **Don't background-agent it** — the
user's verdicts drive the output.

### Phase 1 — Inventory (one-time setup)

Read once:
1. `~/.agents/rules/csharp/` (or similar global rules location)
2. The target project's `.editorconfig`
3. `tools/audit/rules/*.lint.ts` if the project uses regent
4. The target project's `AGENTS.md` / `.agents/rules/`

Output: mental map of "doc / Roslyn-enforced / regent-enforced /
project-specific". Read what you need per snippet.

### Phase 2 — Pick a snippet (loop body, repeat 10–20 times)

Pick ONE snippet per concern. Good first picks:

- Controller action (route handling, DI patterns)
- Domain entity (init/set mix, value-object conventions)
- EF repository (snake_case, async LINQ)
- BackgroundService (raw vs abstract base)
- Test setup (xUnit vs NSubstitute)
- Value object (record vs class, factory validation)
- Refit interface (DTO separation, file length)
- Stub/fixture (`*Stub.cs`, `*Fixture.cs`)
- Custom exception (stable `Code` constant)
- Logging call (structured vs interpolated)

Pick by **concern diversity** — each snippet exercises 1–3 distinct rule
layers. Don't dump every snippet.

### Phase 3 — Show 3-layer analysis

For each snippet, present:

1. **The code** (real, from the project — not synthetic)
2. **Layer 1 — global rules** (markdown says what?)
3. **Layer 2 — project .editorconfig** (Roslyn enforces what?)
4. **Layer 3 — regent bundle** (if applicable, what does AST catch?)
5. **Convergence / divergence / gap** per concern:
   - **converge** — all layers agree → ✅ OK
   - **diverge** — layers disagree → ask the user
   - **gap** — no rule covers → user decides "rule needed" or "convention only"

### Phase 4 — User verdict (one of)

- **"OK as-is"** — append row with `OK as-is` status
- **"Not OK / rule needed"** — append row with action item
- **"Open question"** — append row with `OPEN` status

Append-only table:

```markdown
| # | Pattern | Source | Status | Action |
|---|---------|--------|--------|--------|
| N | <name> | `<file:line>` | OK as-is / rule needed / OPEN | <description> |
```

### Phase 5 — Repeat

Different concern. After 10–20 rounds the audit document has enough.

## End state

Group the rows:

1. **OK as-is** — current code follows the rule. No action.
2. **Rule needed** — concrete actions:
   - **Doc fix** — global markdown rule is wrong
   - **Editorconfig fix** — add `dotnet_diagnostic.<RULE> = error`
   - **Regent AST rule** — write `tools/audit/rules/<name>.lint.ts`
   - **Code fix** — update the actual code
3. **OPEN** — back-burner

Deliver as `.planning/style-shaping-<project>.md`. Append-only until
the user closes the audit.

## Tooling

- **Read** (pull files) — primary
- **Grep** (find patterns) — secondary
- **Write** (append audit doc) — once per verdict
- **No background agents** during interactive loop — context matters

## Anti-patterns

- Don't dump every snippet at once — one at a time
- Don't propose rules without an enforcement layer
- Don't conflate convention and rule (convention = doc-only; rule = enforced)
- Don't trust synthetic examples — pull real code
- Don't over-analyze — 3 layers + convergence is enough
- Don't fix code in this skill — captures rules, fixes come later

## Worked example (2026-07 plexor dogfood)

Original `style-shaping.md` (issue #110 Phase 1.5 deliverable, in the
regent repo at `.planning/style-shaping.md`) shows 58 patterns across
6 scenarios. Each row carries:

- Pattern name
- Source file:line
- Convergence verdict across global / .editorconfig / regent bundle
- Status (OK as-is / rule needed / OPEN / resolved)
- Action item

The workflow captured 4 global-rule changes, 2 editorconfig fixes,
~13 regent AST rule candidates, ~25 OK-as-is confirmations. All from
~12 interactive rounds.

## Related

- **`code-review`** — Standards-axis review of a diff. This skill is the
  prep work for what `code-review` then enforces.
- **`regent`** — the agent skill that ships the `regent llm` skill
  contract. Use `code-style-shaping` to define what regent should check;
  use `regent` to run the checks.
- **`qa`** — interactive bug-finding. `code-style-shaping` is the
  style-finding equivalent.

## Definition of done

The skill is done when:

- The audit document has ≥ 10 verdicts, each with a real source citation.
- "Rule needed" rows have concrete actions.
- "OK as-is" rows confirm the current code follows the rules.
- The user has signed off on the audit as a whole.

Hand the audit document over. The user decides what to do with the
action items.