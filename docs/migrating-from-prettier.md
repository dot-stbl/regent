# Migrating from prettier to regent

`prettier` is a formatter. `regent` is not — regent ships zero rules,
no formatter, no opinion on whitespace. This document is short
because there's nothing to migrate: prettier keeps formatting,
regent does not replace it.

If you're coming here from "I want to replace prettier with regent",
you don't — they're complementary tools. `regent fix` (in v0.3+,
issues #24 / #25) does **post-detect** content rewrites; it is **not**
a whole-file formatter.

## What regent fix IS

regent's fix pipeline (`#7` epic → `regent fix`):

1. **Detect** — run regex / AST rules, emit findings.
2. **Fix** — apply `RuleFixSpec` replacements: `replace`
   (template-driven), `delete-line`, `function` (programmatic),
   `guidance-only` (no edit; instruction for the agent).
3. **Transform** (issue #25) — last-pass whole-file rewrite, gated by
   `--unsafe`.

`regent fix` produces a unified diff for each finding site. It does
**not** rewrite trailing whitespace, blank lines, or quote style.

## What regent fix IS NOT

- A prettier competitor. No opinion on layout.
- A whole-file formatter. Issues #25 ships `transform(file, content) →
  string` but that's not the same thing as `prettier.format(...)`.
- A `save-on-format` tool. regent doesn't watch files; use
  `editor.formatOnSave` with prettier.

## When regent fix wins

- **Mechanical, deterministic edits** at known spans — `delete the
  .ConfigureAwait(false) call`, `replace throw ex; with throw;`,
  `drop the line`. These are rules' `safe` lane.
- **Agent-friendly structured diffs.** `regent fix --format json`
  (planned, #62) returns `{ applied, suggested, deferred }` — the
  agent gets a stable shape to reason about.

## When prettier wins

- All whitespace, line length, quote style, trailing comma,
  import ordering. Prettier is the right tool for this, full stop.

## Side-by-side config

Run prettier as the on-save formatter and regent as the audit tool:

```json
// .prettierrc.json — unchanged
{ "semi": true, "singleQuote": true }
```

```ts
// .regentrc.ts — new, empty rule set to start
import { defineConfig } from '@dot-stbl/regent';

export default defineConfig({
  rules: { detect: [], fix: [], transform: [], extends: [],
           disable: [], override: {}, accept: [] },
});
```

```json
// package.json scripts
{
  "scripts": {
    "format": "prettier --write .",
    "lint:fix": "regent fix --diff-base HEAD",
    "check": "regent check && prettier --check ."
  }
}
```

## Migrating prettier-replaced rules

A few rules are "this rule existed in eslint and prettier-formatted
everything but the user wanted a real fix". For those:

1. Disable the eslint rule (if any).
2. Author a `defineFixRule({ ... })` in regent (issue #7 P2 — not
   yet shipped).
3. Add the fix to `.regentrc.ts` under `rules.fix`.
4. Run `regent fix --dry-run` to verify the diff; commit; promote to
   the canonical pipeline.

That's the migration shape when prettier's formatting happened to
encode a real semantic change. For pure formatting changes, prettier
is unchanged.

See also: `migrating-from-eslint.md`, `migrating-from-biome.md`.