---
name: regent
description: >-
  Advisor + single entry point for code-quality rules across languages (C#,
  TypeScript, Rust, Go, ...). Use when deciding whether to enforce a convention
  with a NATIVE tool (dotnet format, Roslyn/.editorconfig, rider CLI, prettier,
  eslint, ruff, gofmt, clippy) vs a regent rule; when authoring a regent AST
  rule; or when running checks. Rule of thumb: prefer native tools where they
  exist, write a regent rule ONLY for house-rules no analyzer covers, don't
  over-engineer — and run everything through `regent` as the one command.
---

# regent — code-quality advisor & single entry point

regent runs house-rule checks across languages by **parsing code** (tree-sitter
via ast-grep), so rules are precise — not regex over text. It is built for LLM
agents (machine-readable findings, `regent llm` docs, tri-state review) and is
meant to be the **one command** you run for code quality: its own rules plus,
where useful, delegation to native tools.

## Decide FIRST: native tool or regent rule? (do not over-engineer)

Before writing any regent rule, ask: **does a native tool already enforce this?**
Preference order — highest first:

1. **Native formatter / analyzer** — if the language ships one, use it; do NOT
   reimplement it in regent.
   - **C#**: `dotnet format` (whitespace/style), Roslyn analyzers + `.editorconfig`
     (CAxxxx, naming, nullability), `rider`/`inspectcode` (deep inspections).
   - **TypeScript**: `prettier` (format), `eslint` + `@typescript-eslint` (lint).
   - **Python**: `ruff` (format + lint), `mypy` (types).
   - **Go**: `gofmt`, `go vet`, `staticcheck`.
   - **Rust**: `rustfmt`, `clippy`.
2. **regent `ast` rule** — for a **house rule / convention no analyzer covers**
   (the "we'd otherwise have to write a custom Roslyn analyzer" case). An
   ast-grep rule is far cheaper than a custom analyzer, works across languages,
   and is agent-readable. **This is regent's sweet spot.**
3. **regent `regex` rule (deprecated)** — only for purely textual conventions
   with no structure (commit-message format, TODO-owner). Prefer `ast` for
   anything structural; regex can't tell `x!` from `!=`, a field from a property,
   or `throw ex;` from a comment.

> Rule of thumb: **native tool > regent `ast` rule > regent `regex`.** If a
> native tool does it, delegate — don't duplicate. Reach for a regent rule only
> when the check is a project-specific convention the ecosystem's tools don't know.

## regent is still the single entry point

Even when native tools do the heavy lifting, run everything through `regent check`
so the agent gets **one command and one normalized result** (regent's own rules +
delegated native tools). Don't make the agent remember five CLIs.

## Authoring a regent `ast` rule (once you've decided it's warranted)

```ts
import { defineAstRule } from '@dot-stbl/regent';

export default defineAstRule({
  id: 'csharp.naming.no-public-field',
  language: 'csharp',               // needs a bundle (see `regent bundles`)
  severity: 'warning',
  globs: ['**/*.cs'],
  message: 'Public field — use an auto-property or constant.',
  ast: {                            // an ast-grep rule (pattern + constraints/kind)
    rule: {
      kind: 'field_declaration',
      all: [
        { has: { kind: 'modifier', regex: '^public$' } },
        { not: { has: { kind: 'modifier', regex: '^(const|static)$' } } },
      ],
    },
  },
});
```

- Rule files live in `~/.agents/rules/**` (user-global) or `tools/audit/rules/**`
  (repo), or inline in config under `rules.ast[]`.
- Patterns must parse as valid code. For selector-calls that don't parse
  standalone (e.g. Go `fmt.Println($A)`), use `kind` + `has`/`context` instead of
  a bare pattern.
- **Always verify a new rule on a real repo** — confirm it flags the intended
  construct and nothing else — before committing it.

## Language versions

A bundle (`@ast-grep/lang-<lang>`) pins the tree-sitter grammar. It parses current
syntax; genuinely-new syntax degrades gracefully — tree-sitter localizes the parse
error to that construct and rules elsewhere keep working (safe missed findings,
never wrong ones). Bump the lang pack to advance. `regent bundles` shows the
supported languages and your project's detected language version.

## Commands

```sh
regent check [--all]        # run all rules (+ delegated tools); one report
regent bundles              # supported languages + detected project version
regent llm                  # full agent contract (authoring / schema / examples)
regent explain <rule-id>    # a rule's message + prose source
```
