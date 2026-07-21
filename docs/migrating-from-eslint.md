# Migrating from eslint to regent

`regent` is **not** a drop-in for eslint — it's a multi-mode static
analysis framework with a different rule model. This guide covers the
common migration path: keep eslint for its installed rules, layer regent
on top for the rules eslint doesn't express well (regex-only, AST +
code-aware), and migrate individual rules one at a time.

## TL;DR

| eslint | regent | notes |
|---|---|---|
| `npm install eslint` + `eslint.config.js` | `bun add @dot-stbl/regent` + `.regentrc.ts` | regent has no bundled rules. |
| `.eslintrc.json` | `.regentrc.ts` (`defineConfig({ ... })`) | Zod-validated; `.yaml` and `.json` also supported via cosmiconfig. |
| `eslint.rules.<rule>` | `defineDetectRule({ id, severity, pattern, globs, message, ... })` | `.lint.ts` rule file under `tools/audit/rules/`. |
| `eslint.<plugin>` (e.g. `@typescript-eslint`) | `regent example copy <lang> <rule>` | regent ships curated examples; copy + adapt. |
| `eslint-disable-next-line` | `rules.accept[]` in config | Persistent accept-list, file/line-scoped, with required `--reason`. |
| `eslint --fix` | `regent fix` (planned — see #24/#25/#7 epic) | Not yet shipped; for now, fix patterns are surfaced as JSON for the agent to apply. |

## Top-10 eslint rules → regent equivalents

| eslint rule | regent equivalent | notes |
|---|---|---|
| `no-console` | `regent example copy typescript no-console` | drop-in. |
| `no-unused-vars` | author a per-project rule (no shipped equivalent) | TS has `noUnusedLocals` in `tsc`; most users cover it there. |
| `eqeqeq` | author a regex rule (`pattern: '[^=!]==[^=]'`) | regent ships zero rules; one-liner. |
| `no-undef` | `tsc` (or `noUnusedLocals`) | TypeScript already enforces this at compile time. |
| `prefer-const` | `tsc` (`noUnusedLocals` family) | Same — compile-time guarantee. |
| `no-var` | author a regex rule on TS / JS files | trivial. |
| `no-debugger` | author a regex rule (`pattern: '\\bdebugger\\b'`) | trivial. |
| `@typescript-eslint/no-explicit-any` | `regent example copy typescript no-throw-any` (close enough) | tighten the regex to `\\bas any\\b` for `no-explicit-any`. |
| `no-empty` | author a regex rule on empty blocks | trivial. |
| `no-eval` | author a regex rule | trivial. |

If a rule isn't in `regent example copy <lang>` and is more than a 3-line
regex, **keep it in eslint**. regent is best as a complement, not a
replacement, until the `command` kind (issue #34) lands and lets regent
delegate to eslint natively.

## Side-by-side config

**Before** (eslint flat config):

```js
// eslint.config.js
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tsParser },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
```

**After** (regent):

```ts
// .regentrc.ts
import { defineConfig } from '@dot-stbl/regent';

export default defineConfig({
  rules: {
    detect: [
      {
        id: 'typescript.no-console',
        severity: 'warning',
        pattern: '\\bconsole\\.',
        globs: ['**/*.ts', '**/*.tsx'],
        excludePaths: ['**/*.test.ts'],
        message: 'Avoid console.* in production code — use the logger.',
        source: 'logging.md#no-console',
      },
      {
        id: 'typescript.no-explicit-any',
        severity: 'error',
        pattern: '\\bas any\\b',
        globs: ['**/*.ts', '**/*.tsx'],
        message: 'No `any` — use a precise type or `unknown`.',
        source: 'code-shape.md#no-any',
      },
    ],
    fix: [],        // regent fix lands in v0.3+ (#24/#25)
    transform: [],  // regent transform lands in v0.3+ (#24/#25)
    extends: [],    // regent plugin resolution lands in v0.3+ (#23)
    disable: [],
    override: {},
    accept: [],
  },
});
```

## What to do when there's no regent rule

Three options, in order of preference:

1. **Author a regex rule** (5–15 lines). regent's pattern helpers
   (`patterns.todoComment`, `patterns.privateUnderscoreField`, etc.)
   cover the common shapes; for anything else, hand-written RE2.
2. **Author an AST rule** (`defineAstRule` — issue #43, shipped).
   Use when regex produces false positives (typical with deep
   structural checks).
3. **Keep the eslint rule.** Don't migrate rules that don't pull
   their weight. regent is opt-in per repo; both tools can run side
   by side.

## Running both

Add a `pre-commit` script that runs `eslint` AND `regent check`. CI
matrix can lint with eslint and audit with regent independently. No
runtime conflict — they're independent processes.

## Migrate incrementally

regent ships zero rules. Adopt in this order:

1. Install + add `.regentrc.ts` (empty `rules.detect: []`).
2. Copy one shipped example per pain point (`regent example copy
   csharp no-todo-without-owner`).
3. Add a `regent check` step to CI; mark eslint rules you no longer
   want as deprecated in `eslint.config.js`.
4. Iterate: every new violation in eslint is an opportunity to write
   a regent rule that also surfaces context to the agent.

See also: `migrating-from-biome.md`, `migrating-from-prettier.md`.