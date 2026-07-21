# Migrating to regent

regent ships **zero rules by default** — every rule is authored per
project, or copied from `examples/<lang>/`. This is intentional:
rules-as-executable-prose is the product, not a curated rule set.

These guides walk through the migration paths from the most common
audit tools you might already be running:

- **[migrating-from-eslint.md](./migrating-from-eslint.md)** — keep
  eslint for its installed rule library; layer regent for rules
  eslint doesn't express well (regex, AST + code-aware, agent-friendly).
- **[migrating-from-biome.md](./migrating-from-biome.md)** — keep
  biome for formatting; disable its linter; add regent for the
  audit surface that an agent can read.
- **[migrating-from-prettier.md](./migrating-from-prettier.md)** —
  prettier and regent don't overlap; regent doesn't have a formatter.

## Why migrate (or layer)?

The audit tools listed above are *static rule sets*: the maintainer
ships a list of rules, you opt in or out. regent inverts this:
**you author the rules** — and an LLM agent can author them too,
because each rule is small, named, and has executable prose next to
it (`assets/llm/examples/<lang>/<rule>.md`).

If your pain point is "I have 30 hard-won eslint rules and I want to
preserve them across repos / share with my agent", regent gives you a
better container. If your pain point is "I want a sensible default
rule set", regent is the wrong tool — keep eslint or biome.

## Where to start

1. `bun add @dot-stbl/regent`.
2. `regent init` scaffolds `.regentrc.ts` with an empty rule set.
3. `regent example list` shows what shipped examples are available;
   `regent example copy <lang> <rule>` copies one into your
   `tools/audit/rules/`.
4. `regent check` runs the audit. Add to CI.
5. Iterate: each new violation your team encounters is an opportunity
   to author a regent rule that documents the constraint in code.

## See also

- `CONTRIBUTING.md` — authoring detect / fix / (planned) transform
  rules.
- `skills/regent/SKILL.md` — the agent-side skill that explains when
  to reach for regent vs a native tool.
- [Issue #43](https://github.com/dot-stbl/regent/issues/43) — AST
  rule engine (shipped).
- [Issues #24 / #25](https://github.com/dot-stbl/regent/issues/24) —
  the `transform` rule kind (in flight, v0.3.0).