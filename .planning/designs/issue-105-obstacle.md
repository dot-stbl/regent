# Issue #105 re-target obstacle — design note

Ref: #105, #141, #146
Branch: `feat/105-extends-shorthand-main` (on `main` @ `0249af6`)

## TL;DR

Porting issue #105's `^[xtends` inline-extends feature is **not possible
as a direct re-target onto current `main`**: the entire `scopes`
named-workspaces architecture that #105 was designed against has been
**removed** from `main` since PR #141 merged to `main-2`. There is no
`ScopeSpec`, no `regent-config.scopes` block, no `scopeSpec` parameter on
the loader, and no scope-name resolution on the CLI. The `--scope <dir>`
flag on `main` is a directory path, not a name.

The "widen scope's `extends`" change is a no-op on `main` because there is
no `scope.extends` field to widen. The wider re-introduction of the
named-scopes architecture is its own substantial multi-PR chunk of work —
not in scope for a re-target.

## What existed on `main-2` (PR #141)

The feature commit `6a549aa` on `main-2` shipped against this shape:

```ts
// src/config/schema.ts (main-2)
const ScopeExtendsItemSchema = z.union([
  z.string().min(1),
  z.array(z.unknown()).readonly(),
]);

const ScopeSpecSchema = z
  .object({
    root: z.string().min(1),
    extends: z.array(ScopeExtendsItemSchema).readonly().default([]),
  })
  .strict();

// RegentConfigSchema.scopes = z.record(<name>, ScopeSpecSchema).default({})
```

The loader gained `LoaderOptions.scopeSpec` and spliced the scope's
`extends[]` into the merged config's `rules.extends[]` before the existing
`resolveExtendsItem` loop. `src/cli.ts` resolved `--scope <name>` to a
`ResolvedScope` and forwarded the `ScopeSpec`.

## What exists on `main` today

| Surface                                                | `main-2` (v0.4.1)                           | `main` (v0.6.0+)                          |
| ------------------------------------------------------ | ------------------------------------------- | ----------------------------------------- |
| `RegentConfigSchema.scopes`                            | present, `{ [name]: ScopeSpec }`            | absent (root config is scope-less)        |
| `ScopeSpec`, `ScopeExtendsItem`                        | present                                     | absent (not in `src/`, not in tests)      |
| `src/config/scopes.ts` / `src/config/scope-loader.ts`  | present                                     | absent — files don't exist                 |
| `LoaderOptions.scopeSpec`                              | present                                     | absent — `LoaderOptions` is `{repoRoot, skipLocal, args}` only |
| `LoaderOptions.scope`                                  | present                                     | absent — `cwd` always equals `repoRoot`   |
| CLI: `regent check -s <name>`                          | multi-scope; resolves to a `ResolvedScope`  | `--scope <dir>` is a directory path       |
| CLI: `regent scopes` subcommand                        | present                                     | absent                                    |
| `test/scopes-extends.test.ts`                          | present (5 cases)                           | absent                                    |
| `test/config-schema.test.ts:235-241` (string rejected) | flip needed                                 | file is 187 lines — those lines don't exist |

The git history is unambiguous about which side the scope work landed on:

```
$ git log -- src/config/scope-loader.ts src/config/scopes.ts
f3633f8 [.stbl](feat/scopes/changed-only): scope.changedOnly filters...
6a549aa [.stbl](feat/scopes/extends-shorthand): accept inline extends...
92cffb1 [.stbl](feat/scopes/named-workspaces): ship #35 MVP...
```

All three commits exist only on `main-2`. They are not present on `main`
because the named-scopes design was rolled back before `main` reached
v0.5.

## Why `main` no longer has scopes

`main` v0.5 onwards moved to a simpler model: one config per directory,
`--scope <dir>` to point at a different config (which then walks up to
its own `.regentrc.*`). The "named monorepo scopes" feature was set
aside (issue #35 reopened / de-scoped in the v0.5 backlog).

The substantive work that hasn't changed between branches is the
**schema widening itself** — `RulesSectionSchema.extends` on `main`
already accepts `z.union([z.string().min(1), z.array(z.unknown()).readonly()])`,
and `resolveExtendsItem` in `src/loader.ts` already implements the
inline-array branch (the schema and loader code from #141's spirit
survived the scope rollback). The user-facing capability of "load
an inline rule array from `extends[]`" works *at the top level* today:

```ts
// /repo/.regentrc.ts (works on main today — no #105 work needed)
import { defineConfig } from '@dot-stbl/regent';

export default defineConfig({
  rules: {
    extends: [
      '@dot-stbl/regent-rules-foo',         // npm-shaped
      './tools/audit/extra.lint.ts',         // file
      'tools/audit/**/*.lint.ts',            // glob
      [{                                      // inline array — already supported on main
        id: 'inline.rule',
        severity: 'warning',
        pattern: '\\bTODO\\b',
        globs: ['**/*.ts'],
        message: 'no TODO',
      }],
    ],
  },
});
```

What #105 was specifically asking for was a way to do this **inside a
named-scope entry** — `scopes: { a: { root: 'apps/a', extends: [...] } }`
— so a monorepo could declare multiple scopes with different rule sets
from a single root `.regentrc.*`. That surface isn't on `main`.

## What it would take to re-introduce #105

A minimum re-implementation on `main` would need all of these, in
roughly this order:

1. **Schema** (`src/config/schema.ts`) — re-add `ScopeSpecSchema`,
   `ScopeExtendsItemSchema`, and the `scopes` record on `RegentConfigSchema`.
2. **Scope resolution** (`src/config/scopes.ts`) — re-add
   `ResolvedScope`, `parseScopeNames`, `defaultScopes`, `resolveScopes`.
3. **Scope config loader** (`src/config/scope-loader.ts`) — re-add
   `loadScopeConfigLayer`, `resolveScopeExtends`.
4. **Loader** (`src/loader.ts`) — extend `LoaderOptions` with `scope`
   and `scopeSpec`, splice inline `extends[]` into the merged
   scope config.
5. **CLI** (`src/cli.ts`) — restore `loadRulesForScope`, wire
   `--scope <name>` to name resolution, add `regent scopes` subcommand.
6. **Tests** — port `test/scopes-extends.test.ts` (5 cases from
   main-2's commit `6a549aa`) plus the test/config-schema.test.ts
   flip.
7. **CHANGELOG** — re-publish the "Unreleased" entry from #141
   on `main`'s side of history.

This is on the order of a 600-line PR across seven files. It is a
**scope feature bring-back**, not a re-target. Treating it as a
re-target of #141 would understate the change set, hide the
behavioural implications, and risk silent omissions.

## Recommendation

Options, in order of preference (owner decision):

1. **Close #105 as a stale issue** — `main` no longer carries the
   surface #105 was designed against; the user can already do the
   inline `extends[]` thing via the top-level config. If we want
   named scopes back, file a new issue scoped to "bring back #35 +
   inline extends" and link #105 as a parent.

2. **Land the design note + close #146** — what this PR does. No code
   change; the obstacle is documented and tracked here. Issue #146 is
   the "re-target" issue; closing it with a pointer to this doc is
   clean.

3. **Land the full scope bring-back** — if the maintainer wants
   named scopes back, that needs its own PR + ADR, not a
   re-titled re-target of #105.

## Verification

- `src/config/` on `main`: only `groups.ts`, `index.ts`, `inspect.ts`,
  `merge.ts`, `schema.ts`, `sources/` — no `scope-loader.ts`,
  no `scopes.ts`.
- `src/loader.ts` `LoaderOptions` interface (lines 62–71 on `main`):
  `{ repoRoot?, skipLocal?, args? }` — no `scope`, no `scopeSpec`.
- `src/cli.ts` (49772 bytes on `main`, vs the main-2 version
  carrying `loadRulesForScope`, `parseScopeNames`,
  `resolveScopes`, `defaultScopes`, `ResolvedScope`,
  `ScopeSpec`, `runScopes`): no match for any of those identifiers.
- `test/config-schema.test.ts` on `main`: 187 lines, no
  extends-string-rejection test (the rejection lives on
  `RulesSectionSchema.extends`, not on a `ScopeSpecSchema.extends`,
  and is a different code path).
- `test/scopes-extends.test.ts` on `main`: absent.

The architectural obstacle is structural, not a merge-conflict.
Cherry-picking `6a549aa` cleanly onto `main` would compile but the
schema change would attach to a `ScopeSpecSchema` that doesn't
exist; the loader change would attach to a `scopeSpec` parameter
that doesn't exist; the test would import a `scope-loader.js` that
doesn't exist.
