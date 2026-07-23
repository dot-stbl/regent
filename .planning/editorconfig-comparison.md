# .editorconfig cross-project comparison

## Scope and counting method

This comparison uses the four files as read, without running build, format, test, or other verification commands. `Settings count` means the number of `dotnet_diagnostic.*` assignment lines, including per-glob overrides and duplicate assignments. `Unique rules` means distinct diagnostic IDs appearing anywhere in the file. Severity below is the literal `.editorconfig` severity; it does not apply the projects' `TreatWarningsAsErrors` build setting.

## Per-project summary

| Project | Path | Lines | Settings count | Unique rules |
|---|---|---:|---:|---:|
| anlytra | `C:\Users\bradw\source\stbl\anlytra\.editorconfig` | 376 | 43 | 43 |
| plexor | `C:\Users\bradw\source\stbl\plexor\.editorconfig` | 560 | 121 | 85 |
| tessera | `C:\Users\bradw\source\stbl\tessera\.editorconfig` | 552 | 110 | 76 |
| console.x | `C:\Users\bradw\source\hybrid\console.x\.editorconfig` | 425 | 61 | 61 |

Plexor is the largest file: it adds documented project suppressions, migration/test-controller/BannerArt per-glob overrides, and a larger set of analyzer IDs. Tessera is nearly as large because it carries most of the same per-glob infrastructure. Anlytra and console.x are shorter, flatter configurations.

## Common rules (in all 4)

The following 35 diagnostic IDs occur in all four files. The table shows the literal severity in the order requested: anlytra / plexor / tessera / console.x.

| Diagnostic | Severity (anlytra/plexor/tessera/console.x) | Actual lines / notes |
|---|---|---|
| `IDE0007` | `error / error / error / error` | anlytra `dotnet_diagnostic.IDE0007.severity = error`; plexor `... = error`; tessera `... = error`; console.x `... = error` |
| `IDE0008` | `none / none / none / none` | all four explicitly disable explicit-type preference |
| `IDE0011` | `error / error / error / error` | all four explicitly require braces |
| `IDE0078` | `warning / warning / none / warning` | anlytra `dotnet_diagnostic.IDE0078.severity = warning`; plexor same; tessera migration override uses `none`; console.x `warning` |
| `IDE0083` | `warning / warning / warning / warning` | all four enable the not-pattern diagnostic at warning |
| `IDE0161` | `error / error / error / error` | all four require file-scoped namespaces in the main block; migration overrides lower it |
| `VSTHRD002` | `error / error / error / none` | anlytra lines 115; plexor 157; tessera 157; console.x 116, then console.x later disables it |
| `VSTHRD103` | `error / error / error / none` | anlytra lines 116; plexor 158; tessera 158; console.x 117, then console.x later disables it |
| `VSTHRD104` | `error / error / error / error` | all four use `dotnet_diagnostic.VSTHRD104.severity = error` |
| `VSTHRD110` | `warning / warning / warning / warning` | all four use the warning severity |
| `VSTHRD200` | `error / error / none / error` | anlytra line 112; plexor 150; tessera 150 and later 271; console.x 113 |
| `CA1031` | `none / none / none / none` | all four disable general-exception catching diagnostics |
| `CA1062` | `none / none / none / none` | all four disable argument validation diagnostics |
| `CA1303` | `none / none / none / none` | all four disable localization diagnostics |
| `CA1305` | `warning / warning / warning / warning` | all four enable `IFormatProvider`; migration globs lower this in plexor/tessera |
| `CA1707` | `none / none / none / none` | all four disable underscore-name diagnostics, primarily for tests |
| `CA1716` | `none / none / none / none` | all four disable keyword-name diagnostics |
| `CA1812` | `none / none / none / none` | all four disable uninstantiated internal-class diagnostics for DI |
| `CA1822` | `warning / warning / warning / warning` | all four enable static-member suggestions as warning |
| `CA1860` | `warning / warning / warning / warning` | all four prefer `Count != 0` over `Enumerable.Any()` |
| `CA1862` | `warning / none / none / warning` | anlytra `dotnet_diagnostic.CA1862.severity = warning`; plexor/tessera disable it; console.x `warning` |
| `CA2007` | `none / none / none / none` | all four explicitly disable `ConfigureAwait` analyzer enforcement |
| `CA2008` | `warning / warning / warning / warning` | all four enable task-scheduler diagnostics |
| `CA1852` | `warning / warning / warning / warning` | all four enable sealing diagnostics only at warning, not the global error level |
| `CA2254` | `error / error / error / error` | all four require static logging templates |
| `CA1727` | `warning / warning / warning / warning` | all four enable PascalCase logging placeholders |
| `CA1848` | `none / none / none / none` | all four disable LoggerMessage source-generation diagnostics |
| `RCS1124` | `warning / warning / warning / warning` | all four enable inline-local-variable diagnostics |
| `RCS1173` | `warning / warning / warning / warning` | all four enable if/else-to-ternary diagnostics |
| `RCS1206` | `warning / warning / warning / warning` | all four enable conditional-access diagnostics |
| `RCS1208` | `warning / none / none / none` | anlytra `dotnet_diagnostic.RCS1208.severity = warning`; plexor, tessera, and console.x disable it |
| `RCS1218` | `warning / warning / warning / warning` | all four enable code-branch simplification |
| `RCS1238` | `warning / warning / warning / warning` | all four enable nested-ternary diagnostics |
| `MA0080` | `warning / warning / warning / warning` | all four enable cancellation-token diagnostics |
| `MA0099` | `warning / warning / warning / warning` | all four enable explicit-enum-value diagnostics |

Important: several “common” rules are not common in effective scope because a later per-glob assignment overrides the main-block assignment. The most visible examples are `VSTHRD002`, `VSTHRD103`, `VSTHRD200`, `IDE0078`, `IDE0161`, and `CA1305` in migration files.

## Project-specific rules

“Only” below means the diagnostic ID appears in only that project's file, including per-glob sections. Rules that appear in multiple files but have different severities are covered in **Conflicts** instead.

### anlytra only

No diagnostic ID is exclusive to anlytra. Its 43-rule configuration is a compact baseline, and all of its IDs also occur in at least one other project.

### plexor only

Plexor has the largest exclusive set. Representative actual assignments are:

```ini
dotnet_diagnostic.CMK0001.severity = warning # AccessFilter missing on public controller action — Phase 18 fail-closed authorization.
dotnet_diagnostic.IDE0072.severity = none # populate switch expression — owner-disabled
dotnet_diagnostic.IDE0010.severity = none # populate switch statement — owner-disabled
dotnet_diagnostic.MA0110.severity = none # use Regex source generator — owner-disabled
dotnet_diagnostic.MA0179.severity = none # use Attribute.IsDefined instead of GetCustomAttribute — owner-disabled
dotnet_diagnostic.MA0003.severity = none # name the parameter — argument-name hints are a style preference
dotnet_diagnostic.MA0007.severity = none # trailing comma in collection initializer — noise
dotnet_diagnostic.MA0038.severity = none # make method static — false positive on primary-ctor methods
dotnet_diagnostic.MA0154.severity = none # use langword in XML — false positive on 'try'
dotnet_diagnostic.MA0136.severity = none # raw string contains implicit EOL
dotnet_diagnostic.MA0101.severity = none # string contains non-deterministic EOL
dotnet_diagnostic.CA1873.severity = none # wrap logger.LogX in IsEnabled — IsEnabled wrappers are noise
dotnet_diagnostic.xUnit1004.severity = none # [Fact(Skip = "...")] is the canonical xUnit pattern
dotnet_diagnostic.RCS1228.severity = none # unused param element — delegate callbacks with unused params
dotnet_diagnostic.RCS1247.severity = none # fix doc tag — multiline <c> tag is fine
dotnet_diagnostic.MA0048.severity = none # file name must match type name
dotnet_diagnostic.MA0051.severity = none # method too long (>60 lines)
```

Plexor also has unique per-glob assignments for generated/migration and test-specific cases, including `MA0197`, `CA1861`, `RCS1036`, `RCS1037`, `RCS1038`, `RCS1140`, `RCS1141`, `RCS1142`, `RCS1251`, `MA0182`, `IDE0370`, and `CA1834`. Examples:

```ini
dotnet_diagnostic.RCS1251.severity = none
dotnet_diagnostic.MA0182.severity = none
dotnet_diagnostic.RCS1140.severity = none
dotnet_diagnostic.IDE0370.severity = none
dotnet_diagnostic.CA1834.severity = none
```

### tessera only

Tessera's exclusive IDs are primarily its explicit ConfigureAwait-related VSTHRD suppression and its migration/test overrides:

```ini
dotnet_diagnostic.CA1711.severity = none # identifier should not end in incorrect suffix — role-specific suffixes win
dotnet_diagnostic.VSTHRD111.severity = none # ConfigureAwait — owner-disabled 2026-07-20
dotnet_diagnostic.IDE0320.severity = none # anonymous function can be made static — false positive on closures capturing local vars
dotnet_diagnostic.RCS1140.severity = none
dotnet_diagnostic.IDE0370.severity = none
dotnet_diagnostic.RCS1251.severity = none
dotnet_diagnostic.MA0182.severity = none
dotnet_diagnostic.CA1834.severity = none
```

Unlike plexor, Tessera does not contain the broad project-specific IDs `CMK0001`, `IDE0072`, `IDE0010`, `MA0110`, `MA0179`, `xUnit1004`, or the raw-string suppression pair `MA0136`/`MA0101`.

### console.x only

No diagnostic ID is exclusive to console.x. Its file is shorter than plexor/tessera and has no migration/test-controller/BannerArt rule set. Its main project-specific deviation is not uniqueness but severity: `IDE0046` is enabled, while Tessera disables it and anlytra does not declare it.

## Conflicts (same rule, different severity)

The table includes rules that are present in multiple files with different literal severities. `—` means the file has no assignment for that diagnostic ID. Where a later per-glob override exists, both the main assignment and the override are shown.

| Rule | anlytra | plexor | tessera | console.x | Verdict needed |
|---|---|---|---|---|---|
| `IDE0046` | — | `none` (line 103) | `none` (line 103) | `warning` (line 74) | Decide whether conditional-expression conversion is a universal rule or a console.x preference. |
| `IDE0078` | `warning` | `warning` | `none` in migration globs (lines 472/501) | `warning` | Tessera's generated-code override differs from the other main scopes. |
| `IDE0290` | — | `warning` main, `none` in migrations | `warning` main, `none` in migrations | — | Main code prefers primary constructors in plexor/tessera; generated code is exempt. |
| `VSTHRD002` | `error` | `error` | `error` | `error`, then `none` in console.x's main MA block | Console.x's later suppression contradicts its earlier async prohibition. |
| `VSTHRD103` | `error` | `error` | `error` | `error`, then `none` in console.x's main MA block | Same console.x contradiction; global rules require this at error. |
| `VSTHRD200` | `error` | `error` | `error`, then `none` on line 271 | `error` | Tessera's later suppression contradicts the global async-suffix requirement. |
| `MA0004` | `none` | `none` | — | `none` | The rule is deprecated/removed globally; see Over-enforcement. |
| `MA0006` | `warning` | `none` | `warning` | — | Plexor disables string-comparison guidance; others do not. |
| `MA0040` | `warning` | `warning` | — | — | Anlytra/plexor explicitly enforce forwarding; tessera/console.x do not declare it. |
| `MA0042` | `error` | `none` | `none` | — | Anlytra treats blocking calls as an error; plexor/tessera explicitly suppress it. |
| `MA0045` | `warning` | `none` | `none` | — | Anlytra enables it; plexor/tessera suppress it. Tessera also redeclares it. |
| `CA1720` | `none` | `warning` | `warning` | — | Plexor/tessera enabled identifier-type-name guidance; anlytra disables it. |
| `CA1862` | `warning` | `none` | `none` in the main block | `warning` | Plexor/tessera suppress explicit `StringComparison` guidance; anlytra/console.x retain it. |
| `RCS1208` | `warning` | `none` | `none` | `none` | Anlytra is the outlier; the other three document logger/foreach patterns as intentional. |
| `RCS1194` | — | `none` | `suggestion` main, `none` for domain exceptions | `suggestion` | Tessera's main configuration keeps it visible but suppresses it for domain exceptions; plexor disables globally; console.x keeps a suggestion. |
| `MA0051` | — | `none` | `none` | — | Plexor/tessera suppress the long-method rule; anlytra/console.x do not configure it. |

## Gap analysis (in global rules but NOT in any .editorconfig)

These are global rules that have no adequate analyzer enforcement in the four files. A related diagnostic may exist, but it does not enforce the stated global contract.

| Global rule (file:section) | Reason it should be in .editorconfig | Currently enforced? |
|---|---|---|
| `anti-patterns.md: §6 JsonSerializerOptions` | The global rule bans inline `new JsonSerializerOptions(...)`, shared options fields, `JsonSerializerOptions.Default`, and mutation of `.Web`. No diagnostic assignment checks these patterns. | No; documentation/self-audit only. |
| `class-layout-and-tooling.md: §1a` / `code-shape.md: §9` private methods | The global rule bans private production methods except narrow framework cases. No listed diagnostic enforces “zero private methods.” | No; grep/self-audit only. |
| `class-layout-and-tooling.md: §1b` file length | The global refactor signal is production files over 300 lines. `MA0051` is a different “method too long (>60 lines)” rule and is disabled where present. | No; file-length rule is not encoded. |
| `naming-and-types.md: §1 parameter naming` | Banned abbreviations include `ct`, `req`, `resp`, `msg`, `err`, `ex`, `svc`, `u`, `x`, and `tmp`. The naming blocks cover fields, interfaces, async suffixes, public members, and constants, not parameter names. | No. |
| `naming-and-types.md: §1 lambda parameters` | The global rule bans one-letter lambda parameters except `_`. No diagnostic assignment checks meaningful lambda names. | No. |
| `naming-and-types.md: §1 tuples` and `anti-patterns.md: §3` | Tuples are banned throughout user code. No diagnostic assignment enforces the absence of tuple types/variables. | No. |
| `naming-and-types.md: §2 sealed` | The global rule requires sealed concrete classes and specifies `CA1852` at error. All four files set `CA1852` only to `warning`, and CA1852 primarily targets internal classes rather than every concrete class. | Partial only; not at the global severity/coverage. |
| `constructors-and-fields.md: primary constructors` | The global rule says primary constructors are required for all sealed classes. Only plexor/tessera configure `IDE0290`, at `warning`, and anlytra/console.x only set a style preference without a diagnostic assignment. | Partial only. |
| `code-shape.md: §5 expression-bodied methods` | The global rule bans expression-bodied methods and calls for `IDE0022` at error. Anlytra and console.x do not assign `IDE0022`; plexor/tessera lower it to `suggestion` in migration scopes. | No for ordinary code; partial/generated-code exception only. |
| `code-shape.md: §11 ThrowIf*` | The global rule bans `ArgumentNullException.ThrowIfNull`, `ThrowIfNullOrEmpty`, and related helpers. No diagnostic assignment enforces the ban. | No; grep/self-audit only. |
| `async-and-tasks.md: §3 ConfigureAwait` | The global rule says the old `MA0004` analyzer was removed and the convention is enforced by review. The files either retain a deprecated `MA0004` assignment or rely on `CA2007 = none`; neither encodes the actual source-level convention. | No active analyzer; documentation/self-audit only. |
| `async-and-tasks.md: §4 CancellationToken last/forwarded` | `MA0040`, `MA0080`, and `CA2016` cover pieces of cancellation usage, but no assignment enforces the parameter name `cancellationToken`, last-position requirement, or every nested call receiving the token. | Partial only. |
| `async-and-tasks.md: §6 `_ =` discard` | The global rule bans meaningless `_ =` statements. No diagnostic assignment checks this pattern. | No; worker self-audit only. |
| `code-shape.md: §6 comments` | The global rule limits comments to meaningful “why” explanations. This is not represented by a diagnostic assignment. | No; review only. |
| `anti-patterns.md: §4 ModelState` | The global rule bans `ModelState.AddModelError` and requires FluentValidation. No diagnostic assignment targets the API. | No. |
| `anti-patterns.md: §2 record DTO placement` | Records must be separate files and not embedded in controllers. No editorconfig diagnostic checks type placement. | No. |

Rules that *are* materially represented include file-scoped namespaces (`IDE0161`), braces (`IDE0011`), var preference (`IDE0007`/`IDE0008`), async suffix (`VSTHRD200` where not suppressed), logging templates (`CA2254`), and several cancellation/string/collection analyzer families.

## Over-enforcement (in `.editorconfig` but contradicts global)

| Project | Setting | Contradicts global rule (file:section) |
|---|---|---|
| anlytra | `dotnet_diagnostic.MA0004.severity = none` (line 121) | `naming-and-types.md: §1 ConfigureAwait` and `async-and-tasks.md: §3` explicitly say MA0004 was removed on 2026-07-19. The setting is stale even though its intended outcome is “off.” |
| plexor | `dotnet_diagnostic.MA0004.severity = none` (line 165) | Same deprecated-rule contradiction. Plexor's header also still lists `Meziantou.Analyzer` as required at lines 18–19, while the global rules say it was removed. |
| console.x | `dotnet_diagnostic.MA0004.severity = none` (line 122) | Same deprecated-rule contradiction; console.x also lists `Meziantou.Analyzer` as required at lines 13–14. |
| anlytra | `dotnet_diagnostic.CA1852.severity = warning` (line 126) | `naming-and-types.md: §2` says CA1852 is the enforcement for required sealing and specifies `severity=error`. This is under-enforcement relative to the global contract, despite the setting being active. |
| plexor | `dotnet_diagnostic.CA1852.severity = warning` (line 170) | Same global sealing-severity mismatch. |
| tessera | `dotnet_diagnostic.CA1852.severity = warning` (line 169) | Same global sealing-severity mismatch. |
| console.x | `dotnet_diagnostic.CA1852.severity = warning` (line 127) | Same global sealing-severity mismatch. |
| tessera | `dotnet_diagnostic.VSTHRD200.severity = none` (line 271) | `naming-and-types.md: §1 Async suffix` and `async-and-tasks.md: §1` require async suffix enforcement through `VSTHRD200 = error`. The later assignment disables it for ordinary `*.cs` scope. |
| tessera | `dotnet_diagnostic.VSTHRD002.severity = none` (line 269) | `async-and-tasks.md: §5` bans synchronous waits and names `VSTHRD103` as error enforcement; the global rules also treat blocking async patterns as prohibited. |
| tessera | `dotnet_diagnostic.VSTHRD103.severity = none` (line 270) | `async-and-tasks.md: §5` explicitly requires `.Result`, `.Wait()`, and `.GetAwaiter().GetResult()` to be prohibited and identifies VSTHRD103 as error enforcement. |
| console.x | `dotnet_diagnostic.VSTHRD002.severity = none` and `dotnet_diagnostic.VSTHRD103.severity = none` (lines 269–270) | Same async/blocking-call contradiction. Earlier console.x lines 116–117 set both to `error`, so the file also contains an internal same-file override conflict. |
| anlytra | `csharp_style_expression_bodied_methods = when_on_single_line:silent` (line 212) | `code-shape.md: §5` says expression-bodied methods are banned and requires block bodies; the global rule references `IDE0022` at error. |
| console.x | `csharp_style_expression_bodied_methods = when_on_single_line : silent` (line 213) | Same expression-bodied-method contradiction. |
| plexor | migration override `dotnet_diagnostic.IDE0022.severity = suggestion` (line 490) | The global rule calls for `IDE0022` error, although this is scoped to generated migration files. It is a documented generated-code exception, not universal enforcement. |
| tessera | migration override `dotnet_diagnostic.IDE0022.severity = suggestion` (line 474) | Same generated-code exception to the global expression-bodied-method rule. |
| anlytra | Required-analyzer comment lists `Meziantou.Analyzer` at line 13 | `async-and-tasks.md: §3` and global analyzer context say Meziantou was removed on 2026-07-19. This is stale dependency/configuration documentation, not a `dotnet_diagnostic` severity. |
| plexor | Required-analyzer comments list `Meziantou.Analyzer` and active `MA*` settings | Same global deprecation. Plexor additionally has many MA suppressions that are now inert if the package has actually been removed. |
| console.x | Required-analyzer comment lists `Meziantou.Analyzer` at line 13 and active `MA0004` | Same global deprecation. |

## Overall findings

- The strongest shared baseline is formatting/code shape: `IDE0007`, `IDE0011`, `IDE0161`, logging (`CA2254`/`CA1727`), and the Roslynator simplification set.
- The biggest policy divergence is async enforcement: anlytra/plexor/console.x mostly enable the VSTHRD rules, while Tessera disables `VSTHRD200`, and console.x disables the blocking-call rules later in the same file.
- Plexor and Tessera are not merely larger copies of the baseline: their per-glob generated-code policy and documented analyzer suppressions make them materially project-specific.
- The global rules are substantially broader than `.editorconfig`: private methods, parameter abbreviations, tuples, `ThrowIf*`, `_ =` discards, JsonSerializerOptions usage, record placement, and the 300-line file trigger remain review/self-audit rules rather than analyzer-enforced rules.
- `MA0004` and the required-Meziantou comments are stale in anlytra, plexor, and console.x relative to the global rule set. Tessera correctly omits `MA0004` from its main block but still retains other MA IDs that appear to come from the pre-removal configuration history.
