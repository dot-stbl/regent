# Rule authoring guide

regent ships **zero rules by default**. You (or an LLM agent) author rules as TypeScript modules. Curated templates live under `examples/<lang>/` and are copied in via `regent example copy` — they are not auto-loaded.

For the agent-facing short form, run:

```sh
regent llm authoring detect
regent llm authoring fix
regent llm schema detect
regent llm schema fix
regent llm examples <lang>
```

Source of truth for types: `src/types.ts`, `src/kinds/*`, `src/config/schema.ts`.

---

## Rule kinds and helpers

| Kind | Extension | Helper | Purpose |
|------|-----------|--------|---------|
| **detect** (regex) | `.lint.ts` (legacy: `.rule.ts`) | `defineDetectRule` | Per-line RE2 match → finding |
| **detect** (legacy alias) | same | `defineRule` | Same as detect; **deprecated** — prefer `defineDetectRule` |
| **fix** (string) | `.fix.ts` | `defineFixRule` | Standalone match → replace (prettier-lite) |
| **ast** | `.lint.ts` / inline `rules.ast[]` | `defineAstRule` | ast-grep parse + match (preferred for structure) |
| **transform** | `.transform.ts` | `defineTransformRule` | Whole-file pure rewrite (pipeline follow-up) |
| **format** | `*.format.ts` / `rules.format[]` | `defineFormat` | Shell out to mutating tools (`prettier --write`, `dotnet format`, …) |
| **delegate** | `*.delegate.ts` / `rules.delegate[]` | `defineDelegate` | Shell out to read-only tools (`eslint`, `ruff check`, …) |

Import from `@dot-stbl/regent`:

```ts
import {
  defineDetectRule,
  defineFixRule,
  defineAstRule,
  defineRule,      // legacy
  defineConfig,
  patterns,
} from '@dot-stbl/regent';
```

---

## Detect rules (`.lint.ts`)

### Skeleton — `defineDetectRule`

```ts
// csharp.no-todo-without-owner.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'csharp.no-todo-without-owner',
  severity: 'error',                    // error | warning | suggestion
  pattern: '//\\s*(TODO|FIXME)\\b',     // RE2 source, per-line
  excludeWhen: '//\\s*(TODO|FIXME)\\s*\\(',  // positive-match inversion
  globs: ['**/*.cs'],
  excludePaths: ['@generated'],
  message: 'TODO without owner',
  source: 'code-shape.md#todo-without-owner',  // optional; sibling .md auto-derives
  rationale: 'every TODO needs a ticket reference',
  review: {
    enabled: true,
    exitBehavior: 'unreviewed-fails',   // or 'no-fail' (default)
    guidance: 'add a ticket ref like TODO(ANL-123)',
  },
  dependsOn: [],                        // optional DAG ordering
  fix: { /* optional RuleFixSpec — see Fix attachment */ },
});
```

### Field reference

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Stable, namespaced (`<lang>.<topic>`) |
| `severity` | yes | `error` / `warning` / `suggestion` — drives exit + colour |
| `pattern` | yes | RE2 string (or function form for parameterised rules) |
| `excludeWhen` | no | RE2; lines matching **both** pattern and excludeWhen are dropped |
| `globs` | yes | File globs to scan |
| `excludePaths` | no | Globs and/or `@group` refs |
| `message` | yes | Short human message |
| `source` | no | Help URI / prose link; auto-derived from sibling `.md` |
| `rationale` | no | Longer explanation above the context snippet |
| `review` | no | Tri-state review (`enabled`, `guidance`, `exitBehavior`) |
| `fix` | no | `RuleFixSpec` attachment (see below) |
| `dependsOn` | no | Rule ids that must run first (DAG) |
| `params` | no | Zod schema for `rules.configure[<id>]` (parameterised rules) |

### Legacy `defineRule`

`defineRule` accepts the same `RuleSpec` shape (including optional `fix`). Prefer `defineDetectRule` for new code. Many shipped examples under `examples/` still use `defineRule`.

---

## RE2 constraints

Patterns are compiled with **re2-wasm** (linear-time, no ReDoS).

**Supported (common):** `\b`, `\s`, `\d`, `^` / `$` (line), `(a|b)`, `(?:…)`, character classes, lazy `*?`.

**Not supported:**

- Backreferences (`\1`, `\k<name>`)
- Lookahead / lookbehind (`(?=…)`, `(?!…)`, `(?<=…)`, `(?<!…)`)

**Per-line only.** Multi-line regex is not supported. Compose per-line patterns and use `excludeWhen` for “X but not Y”:

```ts
pattern: 'X',
excludeWhen: 'Y',   // lines matching both are suppressed
```

Composable builders: `patterns.todoComment()`, `patterns.trailingWhitespace()`, `patterns.configureAwaitFalse()`, etc. — see `regent llm authoring detect`.

---

## AST rules (`defineAstRule`)

Prefer AST when structure matters (regex cannot tell `.Property("Id")` from `.HasColumnName("id")`).

```ts
import { defineAstRule } from '@dot-stbl/regent';

export default defineAstRule({
  id: 'csharp.naming.no-public-field',
  language: 'csharp',               // bundle id (see language packs)
  severity: 'warning',
  globs: ['**/*.cs'],
  message: 'Public field — use an auto-property or constant.',
  source: 'naming.md#public-fields',
  rationale: '…',
  excludePaths: ['@generated'],
  ast: {
    rule: {
      kind: 'field_declaration',
      all: [
        { has: { kind: 'modifier', regex: '^public$' } },
        { not: { has: { kind: 'modifier', regex: '^(const|static)$' } } },
      ],
    },
    // optional: constraints, utils — passed through to ast-grep
  },
});
```

| Field | Notes |
|-------|--------|
| `language` | Bundle / pack name (`csharp`, `typescript`, `rust`, `go`, …). Packs come from `@ast-grep/lang-*` and are registered lazily. |
| `ast` | `AstGrepConfig`: `{ rule, constraints?, utils? }` — full ast-grep rule language |
| `globs` / `excludePaths` / `message` / `source` / `rationale` | Same roles as detect |

Patterns in `ast.rule` must parse as valid code where possible. For selector-style calls that do not parse standalone, use `kind` + `has` / relational operators instead of a bare pattern string.

Inline placement: `rules.ast[]` in `.regentrc.ts`. File discovery: same trees as detect (global + `tools/audit/rules/`).

---

## Fix attachment (`RuleFixSpec`)

Optional `fix` on a **detect** rule (not the same as a standalone `.fix.ts` / `defineFixRule`). Discriminated on `kind`:

| `kind` | Shape | When |
|--------|-------|------|
| `replace` | `template: string`, optional `targetGroup` | Match → substitute. Empty template = delete match. `$1`, `$2`, `${name}`, `$$` |
| `delete-line` | optional `alsoDeleteMatching` (RE2) | Drop matched line (+ trailing newline); optional paired line |
| `function` | `apply: (ctx) => RuleFixEdit[] \| null` | Programmatic byte-span edits; pure + deterministic |
| `guidance-only` | (no edit) | Surface `title` + `guidance` in agent `suggested[]` only |

Every fix has:

- `safety: 'safe' | 'suggested'`
- `title: string` (required)
- `guidance?: string`
- `converges?: boolean` (opt into fixpoint re-scan; default `false`)

### Safety lanes

| `safety` | `regent fix` default | With `--unsafe` |
|----------|----------------------|-----------------|
| `safe` + concrete kind | Auto-applies | Auto-applies |
| `suggested` + replace / delete-line / function | Surfaces in `suggested[]` | Applies |
| `suggested` + guidance-only | Surfaces in `suggested[]` | Still surfaces only (never auto-applies) |

Loader invariant (`validateFixSpec`): **`safe` + `guidance-only` is rejected**. Guidance-only must be `suggested`.

### `converges`

When `true`, after applying this rule’s edit the engine re-detects the file and re-applies other converging rules until no edits or `maxPasses` (default 5, hard cap 20). Mark only mechanically idempotent fixes (`delete-line`, fixed-template `replace` that does not re-trigger). Otherwise you risk `ApplyFixesConvergenceError`.

### `function` contract

```ts
apply: ({ filePath, content }) => {
  // pure: no I/O, no clock/random, no global mutation
  // return null to decline; [] = no edits but not a decline
  return [{ start: 0, end: 3, replacement: 'x' }];
}
```

### Standalone fix rules (`.fix.ts`)

```ts
import { defineFixRule, patterns } from '@dot-stbl/regent';

export default defineFixRule({
  id: 'meta.no-trailing-whitespace',
  severity: 'warning',
  find: patterns.trailingWhitespace().toRegex(),
  replace: '',
  all: true,                    // default: every match
  globs: ['**/*'],
  excludePaths: ['@generated', '@node-modules', '@build-output'],
  message: 'strip trailing whitespace at end of line',
});
```

Idempotency: after one apply, `find` must no longer match (or `--check`-style flows report a permanent diff).

Long form: `regent llm authoring fix` → `assets/llm/authoring/fix.md`.

---

## `excludePaths` and named groups

`excludePaths` accepts globs and **`@name` group references**. Built-ins (`src/config/groups.ts`):

| Group | Typical globs |
|-------|----------------|
| `@generated` | `**/*.g.cs`, `**/*.Designer.cs`, `**/Generated/**`, `**/__generated__/**` |
| `@migrations` | `**/Migrations/**`, `**/*Migration.cs` |
| `@build-output` | `**/bin/**`, `**/obj/**`, `**/dist/**`, `**/build/**`, `**/out/**` |
| `@node-modules` | `**/node_modules/**` |
| `@git` | `**/.git/**` |
| `@ide` | `**/.vscode/**`, `**/.idea/**` |
| `@vendored` | `**/vendor/**`, `**/third_party/**`, `**/external/**` |

User groups in config:

```ts
export default defineConfig({
  excludeGroups: {
    'contract-tests': ['**/ContractTests/**'],
  },
  excludePaths: ['@generated', '@contract-tests'],
});
```

User groups override built-ins on name collision (loader warns). Group names: lowercase kebab-case, start with a letter.

---

## Fixtures (shipped examples)

Under `examples/<lang>/__fixtures__/<rule-id>/`:

| File | Role |
|------|------|
| `bad.<ext>` | Must produce ≥1 finding |
| `good.<ext>` | Must produce 0 findings |
| `fixed.<ext>` | Optional: **literal** engine output of `regent fix` on `bad` (not necessarily identical to human-cleaned `good`) |

Regenerate `fixed.<ext>` by copying `bad` + the rule into a scratch tree and running the fix CLI (see authoring fix docs). Tests: `test/fixtures.test.ts` / shipped-examples suite.

Agent docs for each example: `assets/llm/examples/<lang>/<rule>.md` via `regent llm examples <lang>.<rule>`.

---

## Where rules are loaded

Discovery (`src/loader.ts`), after config merge:

1. **User-global files** — `~/.agents/rules/**/*.{lint,rule,ts}` (and AST/transform/format/delegate variants). Override root with `STBL_REGENT_GLOBAL_RULES_PATH`.
2. **Project rule files** — `<cwd>/tools/audit/rules/**/*.lint.ts` (and AST/transform siblings).
3. **Format / delegate files** — `<cwd>/tools/audit/*.format.ts`, `*.delegate.ts` (one level above `rules/`).
4. **Inline config** — `rules.detect[]`, `rules.fix[]`, `rules.ast[]`, `rules.transform[]`, `rules.format[]`, `rules.delegate[]`.
5. **`rules.extends[]`** — paths, globs, npm package specs, or inline rule arrays.
6. **`rules.disable[]` / `rules.override{}` / `rules.configure{}` / `rules.accept[]`**.

Sibling prose: each `.lint.ts` may pair with `<basename>.md`; loader fills `source` when omitted.

**Not auto-loaded:** `examples/` — use `regent example copy <lang> <rule-id>` into `tools/audit/rules/`, or `extends` a path.

Legacy layout: `tools/audit/config.ts` / `config.local.ts` still work; `regent init` scaffolds the tree; `regent migrate` moves legacy config toward `.regentrc.ts`.

---

## Decision: native tool vs regent rule

Prefer ecosystem tools when they already enforce the check:

1. **Native** — `dotnet format` / Roslyn, prettier + eslint, ruff, gofmt, rustfmt + clippy, …
2. **regent AST** — house conventions no analyzer covers (sweet spot).
3. **regent regex detect** — purely textual (TODO owner, trailing whitespace); avoid for structural code.

Wire natives through **format** / **delegate** specs so `regent check` remains the single entry point. See `skills/regent/SKILL.md` and `docs/agent-workflow.md`.

---

## Related

- [Agent workflow](./agent-workflow.md)
- [Configuration](./config.md)
- `assets/llm/` — `regent llm` pages
- `examples/` — copyable rules + fixtures
- OpenSpec: `openspec/specs/static-analysis`, `auto-fix`, `agent-contract`
