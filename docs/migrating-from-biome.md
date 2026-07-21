# Migrating from biome to regent

biome and regent overlap at "fast, zero-config, single-binary linter
+ formatter". They diverge at "rules-as-executable-prose" — regent
treats each rule as a small, shippable artifact that an LLM agent can
read and author, whereas biome ships a fixed rule set.

This guide covers the common migration: keep biome for formatting and
its installed rule set, layer regent on top for the rules biome
doesn't express well.

## TL;DR

| biome | regent | notes |
|---|---|---|
| `npm install @biomejs/biome` + `biome.json` | `bun add @dot-stbl/regent` + `.regentrc.ts` | regent has no bundled rules. |
| `biome.json` rules | `.regentrc.ts` (`defineConfig({ ... })`) | YAML / JSON also supported via cosmiconfig. |
| `biome.<group>.<rule>` | `defineDetectRule({ id, severity, pattern, globs, message, ... })` | `.lint.ts` rule file under `tools/audit/rules/`. |
| `biome --write` (formatter) | `regent fix` (planned — see #24/#25/#7 epic) | regent fix runs **after** detect; biome runs formatting on save. |
| `biome.linter.skip` | `rules.disable[]` in config | Per-rule disable, scoped to paths / globs. |
| `biome suppressions (`// biome-ignore`) | `rules.accept[]` in config | Persistent accept-list with required `--reason`. |

## Top-10 biome rules → regent equivalents

| biome rule | regent equivalent | notes |
|---|---|---|
| `noConsole` | `regent example copy typescript no-console` | drop-in. |
| `noExplicitAny` | author a regex rule (`pattern: '\\bas any\\b'`) | trivial. |
| `useConst` | `tsc --noUnusedLocals` | compile-time guarantee. |
| `noUnusedVariables` | `tsc` (`noUnusedLocals`) | same. |
| `noVar` | author a regex rule (`pattern: '\\bvar\\b'`) | trivial. |
| `useImportExtensions` | biome is the right tool | leave to biome. |
| `useNodejsImportProtocol` | biome is the right tool | leave to biome. |
| `useTemplate` | author a regex rule or keep biome | biome's `useTemplate` is sophisticated; regent doesn't have an equivalent. |
| `useExhaustiveDependencies` | author a regex rule or keep biome | needs parser awareness; out of scope for the simple regex kind. |
| `noConsoleLog` | `regent example copy meta no-console` (broader regex) | ship a tighter variant if needed. |

## Side-by-side config

**Before** (`biome.json`):

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noConsoleLog": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true
  }
}
```

**After** (regent, plus biome still for formatting):

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
        excludePaths: ['**/*.test.ts', '**/scripts/**'],
        message: 'No console.* — use the project logger.',
        source: 'logging.md#no-console',
      },
    ],
    fix: [], transform: [], extends: [], disable: [], override: {}, accept: [],
  },
});
```

```json
// biome.json (keep for formatting only)
{
  "linter": { "enabled": false },
  "formatter": { "enabled": true }
}
```

Disable biome's linter entirely; regent owns the audit surface, biome
keeps formatting on save.

## What to do when there's no regent rule

1. **Author a regex rule** (5–15 lines) for structural patterns.
2. **Author an AST rule** (`defineAstRule`) for anything that needs
   parser awareness (issue #43 shipped this).
3. **Keep biome's rule.** Don't migrate rules that are working. regent
   is opt-in; both tools run side by side without conflict.

## Running both

- biome on save: formats files (no audit).
- regent in CI: surfaces findings, including context to the agent
  via `regent fix --format json` (planned).

This pairing is closer to "biome + an agentic audit layer" than
"regent replaces biome" — regent doesn't have a formatter, doesn't
have a pre-built rule library, and is best at rule shapes that aren't
covered by either eslint or biome.

## Migrate incrementally

1. Disable biome's `linter.enabled` (`true` → `false`); keep its
   formatter.
2. Add `.regentrc.ts` with one or two high-value rules (e.g.
   `csharp.async.configure-await` from `regent example copy`).
3. Add `regent check` to CI alongside `biome format --check`.
4. Iterate.

See also: `migrating-from-eslint.md`, `migrating-from-prettier.md`.