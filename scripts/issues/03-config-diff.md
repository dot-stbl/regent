## Context

`loadConfig()` returns `sources: { global, project, local, env, args }`
but values are strings, not ResolvedConfig per layer. No command
lets the user see "where did this value come from" — when an
override surprises them, they have to manually inspect every
layer.

## Current behaviour

`loadConfig()` returns a sources object with string markers
(`'global: <loaded>'` etc). No CLI exposes this.

## Expected behaviour

- `regent config show <field>` — merged value + per-layer origin
- `regent config diff` — fields where any non-default layer overrode
  the default, shown as a diff
- `regent config layers` — list of all 5 layers and whether each
  contributed

## Acceptance criteria

- [ ] `regent config show cache.enabled` prints the merged value AND
      each layer's contribution (with file path or env var name)
- [ ] `regent config diff` shows a unified-diff style output for
      overridden fields
- [ ] `regent config layers` lists the 5 layers in precedence order
- [ ] Test: `test/config-show.test.ts` covers all 3 commands

## References

- src/config/index.ts:loadConfigResult.sources (string markers)
- src/llm-router.ts (CLI command pattern)
- Plan: Phase 1.5a config foundation
