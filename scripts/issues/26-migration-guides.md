## Context

Plan called for this. CONTRIBUTING.md has authoring rules but
no "switching from X" guide. Need:
- eslint: rule → regent pattern mapping table
- biome: ditto
- prettier: how to reproduce a config in regent (mostly via
  `meta/*` fix rules)
Ship as `docs/migrating-from-{eslint,biome,prettier}.md`.

## Current behaviour

No migration docs. Users coming from eslint/biome/prettier
have to manually map each rule to a regent equivalent (which
often doesn't exist — they have to write it).

## Expected behaviour

Three docs at `docs/migrating-from-<tool>.md`:
- Top-10 most common rules from each tool → regent equivalent
- Side-by-side config comparison
- "If you can't find a regent rule for X, here's how to author
  one in 5 minutes" (links to `regent llm authoring`)
- Caveats: RE2 syntax differences, per-line scope

## Acceptance criteria

- [ ] `docs/migrating-from-eslint.md`
- [ ] `docs/migrating-from-biome.md`
- [ ] `docs/migrating-from-prettier.md`
- [ ] Each doc covers >= 5 common rules with regent equivalents
- [ ] Each doc links to `regent llm authoring` for custom rules
- [ ] CI linter (markdown link check) passes

## References

- CONTRIBUTING.md
- Plan: Phase 15
