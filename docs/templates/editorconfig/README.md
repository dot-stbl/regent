# editorconfig — strict, auto-fix-friendly, regent-aligned

> Canonical .editorconfig for the user's .NET projects. Not applied to
> console.x (independent project). Adopt in anlytra, plexor, tessera as a
> base — strip MA*, fix over-enforcement, drop per-glob generated-code
> overrides that are no longer needed (migrations etc.).

## Design principles

1. **Auto-fixable rules first.** Every rule listed here should be either
   fixable by `dotnet format` (whitespace, var, namespaces, braces) or by
   JetBrains Rider's "Reformat Code". An agent should never have to
   manually rewrite code to satisfy these.
2. **Severity = error for non-negotiable rules.** A rule that fails the
   build (`error`) must be:
   - Either auto-fixable, or
   - Trivially-correct-by-default for any reasonable code path.
3. **Severity = warning for stylistic preferences.** A warning is a hint,
   not a gate — the agent gets a chance to write idiomatic code that the
   linter doesn't understand.
4. **`none` only for explicit project-suppressions.** A `none` is a
   per-rule decision: "I know Roslyn would flag this, and I'm opting
   out for a specific reason." Every `none` has a comment.
5. **No MA* (Meziantou) — removed 2026-07-19.** The package is uninstalled,
   these settings are dead. If you copy from a project that still has
   them, delete.
6. **No per-glob generated-code overrides at the base level.** Those are
   project-specific (plexor has EF Core migrations, console.x has its
   own generator). Project files can add their own `[**/Migrations/**]`
   blocks AFTER adopting the base.

## Auto-fix surface (what `dotnet format` will fix)

`dotnet format --severity hidden` will fix:

- `IDE0007` — `var` for built-in types
- `IDE0011` — braces on if/else/for/foreach/while
- `IDE0046` — ternary over if/else
- `IDE0078` — pattern matching over `is`-with-cast
- `IDE0083` — pattern matching over `not`-pattern
- `IDE0161` — file-scoped namespace
- `IDE0290` — primary constructor (partial fix)
- `IDE0305` — collection expressions
- `RCS1124` — inline local variable
- `RCS1173` — ternary over if/else
- `RCS1206` — conditional access
- `RCS1208` — reduce if-nesting
- `RCS1218` — simplify code branching
- `RCS1238` — avoid nested ternary

## Severity rationale (one row per rule)

| Rule | Severity | Why | Auto-fix |
|---|---|---|---|
| `IDE0007` | `error` | `var` for built-in types is non-negotiable per `code-shape.md §1` | ✅ format |
| `IDE0008` | `none` | inverse of 0007 — explicit type preference | — |
| `IDE0011` | `error` | braces are non-negotiable per `code-shape.md §5` | ✅ format |
| `IDE0046` | `error` | ternary for return-style — non-negotiable | ✅ format |
| `IDE0078` | `warning` | pattern matching over `is`-with-cast | ✅ format |
| `IDE0083` | `warning` | `not`-pattern over `is null` | ✅ format |
| `IDE0161` | `error` | file-scoped namespace | ✅ format |
| `IDE0290` | `warning` | primary ctor preferred but not always applicable | partial |
| `IDE0305` | `warning` | collection expressions `[]` | ✅ format |
| `CA1002` | `warning` | no `List<T>` in public API; use `IReadOnlyCollection<T>` | — |
| `CA1014` | `warning` | CLS-compliant (rare exception: pinvoke/dllimport) | — |
| `CA1303` | `none` | localization off | — |
| `CA1716` | `none` | no keyword names | — |
| `CA1720` | `warning` | identifier contains type name (e.g. `ExceptionX`) | — |
| `CA1727` | `warning` | logging placeholders PascalCase (CA rule, not naming) | — |
| `CA1812` | `none` | no uninstantiated internal class (DI) | — |
| `CA1822` | `warning` | mark members as static | — |
| `CA1852` | `error` | seal every concrete class — global `naming-and-types.md §2` | — |
| `CA1860` | `warning` | prefer `Count != 0` over `Any()` | — |
| `CA1862` | `none` | explicit `StringComparison` overloads — owner-disabled 2026-07-13 (verbose) | — |
| `CA2000` | `none` | dispose objects before losing scope (false positives) | — |
| `CA2007` | `none` | ConfigureAwait — global ban, doc-only | — |
| `CA2008` | `warning` | do not create tasks without TaskScheduler | — |
| `CA2016` | `warning` | forward CancellationToken (BCL) | — |
| `CA2254` | `error` | template should be static expression (logging) | — |
| `CA1720` | `warning` | identifier contains type name | — |
| `VSTHRD002` | `error` | do not use `.GetAwaiter().GetResult()` (sync over async) | — |
| `VSTHRD103` | `error` | do not use `.Wait()` / `.Result` / blocking calls in async | — |
| `VSTHRD104` | `error` | do not use `async void` | — |
| `VSTHRD110` | `warning` | observe awaited result | — |
| `VSTHRD200` | `error` | async method must end with `Async` suffix | — |
| `RCS1124` | `warning` | inline local variable | ✅ format |
| `RCS1173` | `warning` | simplify if-else to ternary | ✅ format |
| `RCS1206` | `warning` | conditional access vs explicit null check | ✅ format |
| `RCS1208` | `warning` | reduce if-nesting | ✅ format |
| `RCS1218` | `warning` | simplify code branching | ✅ format |
| `RCS1238` | `warning` | avoid nested ternary | ✅ format |

## Adoption path

1. **Copy this file** into the project root as `.editorconfig`.
2. **Remove** the project's existing `.editorconfig` (after diffing the
   per-glob blocks — those that are project-specific stay in the new
   file's project-specific section).
3. **Add per-glob overrides** AFTER the base settings, only for things
   that are actually project-specific (e.g. EF Core migrations).
4. **Run `dotnet format --verify-no-changes --severity hidden`** — should
   pass on a clean codebase.
5. **Run `dotnet build`** — should pass without `TreatWarningsAsErrors=false`.

## Migration from existing projects

### anlytra (376 lines → ~120 lines expected)

- Drop `MA*` block (lines 260–284) — all `MA*` rules removed
- Drop `ReSharper/` block — project-specific, but re-add only the
  settings the project actually needs
- Drop per-file overrides that are now in the base
- Bump `CA1852` from `warning` to `error`

### plexor (560 lines → ~140 lines expected)

- Drop all `MA*` blocks — they are dead since 2026-07-19
- Drop per-glob `Migrations` and `BannerArt` overrides — they are now
  in the per-project section, not the base
- Move `dotnet_style_expression_bodied_methods` from per-line style to
  global ban (move from `silent:silent` to `false:error` via IDE0022)
- Bump `VSTHRD002/103/200` to `error` (line 165/170/etc.)
- Bump `CA1852` from `warning` to `error`

### tessera (552 lines → ~130 lines expected)

- Drop all `MA*` blocks
- Drop the `dotnet_diagnostic.VSTHRD200.severity = none` override (line 271)
  — that suppression is the project-specific divergence
- Drop the `dotnet_diagnostic.RCS1194.severity = suggestion` exception
  for domain exceptions (use the `[Serializable]` attribute or document
  separately)
- Bump `VSTHRD200` to `error`

### console.x (NOT ADOPTED)

This is a separate project used by many. It has its own per-glob generated-
code rules. **Do not apply this template** — console.x is a different
ecosystem with its own conventions.

## Regent alignment

For rules that **regent covers via AST rules**, see `tools/audit/rules/`:

| Global rule | Regent rule (if exists) |
|---|---|
| Braces | — (covered by `IDE0011`) |
| Primary ctor | — (covered by `IDE0290`) |
| Sealed | — (covered by `CA1852`) |
| Async suffix | — (covered by `VSTHRD200`) |
| No public fields | — (covered by `CA1051`) |
| ThrowIf* ban | planned `csharp.exceptions.throw-if-null.lint.ts` |
| ConfigureAwait ban | planned `csharp.async.no-configureawait.lint.ts` |
| Tuples banned | planned `csharp.naming.no-tuples-in-user-code.lint.ts` |
| Banned abbrevs (`ct`/`ex`) | planned `csharp.naming.no-banned-abbrevs-in-params.lint.ts` |
| `IReadOnlyCollection` not `List` | planned `csharp.collections.no-list-return-public-api.lint.ts` |

The .editorconfig handles **format + style**. Regent handles
**semantic patterns the analyzer family doesn't cover**.
