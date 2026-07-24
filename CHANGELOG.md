# Changelog

All notable changes to `@dot-stbl/regent` are recorded here. Dates are
UTC and approximate. Project tags follow the [commit-format](../../)
project rule (`[.stbl](feat/<area>): <subject>`).

## v0.5.0 — config plugins + cross-language helpers

Released 2026-07-24.

Ships the first half of the **config-plugins epic (#34)** — parameterised
rules and the format/delegate author surface plus file-based discovery —
together with the cross-language pattern-helper backlog carried over from
v0.4.0. The runner + safe-invocation + output-pipeline half (34b) is
deferred to v0.6.

### Added — config plugins (#34, #33)

#### Plugin resolution via `extends: '@scope/name'` (#23)

- Loader resolves `extends: '@scope/regent-rules-x'` (or any
  `@scope/name`) as an npm package and merges its exported rules.
  Local file paths still work; npm resolution is the new path that
  enables shipping rule bundles for downstream projects.
  [#91](https://github.com/dot-stbl/regent/pull/91) (`fc9788d`)
  closes [#23](https://github.com/dot-stbl/regent/issues/23).

#### Parameterised rules (#33)

- `params: { … }` on `defineRule` — the loader validates per-instance
  config against a Zod schema derived from the params shape.
  [#96](https://github.com/dot-stbl/regent/pull/96) (`53b9ed9`).
- Loader `params` step — looks up each spec's params in the merged
  config and threads the parsed value into the rule factory; unknown
  params fail loud at load time.
  [#99](https://github.com/dot-stbl/regent/pull/99) (`dabd1d6`).

#### `defineFormat` / `defineDelegate` author surface (34a)

- Two helpers, two specs: `defineFormat` (file-mutating tools) and
  `defineDelegate` (read-only analyzers). Each gets its own spec
  shape; the runner integrates them in 34b (deferred to v0.6).
- Schema wires `rules.format[]` and `rules.delegate[]` arrays next to
  the existing `rules.detect[]`. Tests: 16 across
  `test/kinds/format.test.ts` + `test/kinds/delegate.test.ts`
  (frozen, plain-string, function-form, schema-rejects-unknown-keys).
  `CONTRIBUTING.md` author guide updated.
  [#100](https://github.com/dot-stbl/regent/pull/100) (`1bfe3b4`).

#### File discovery + bundles + auto-detect (34c)

- `loader/format-files.ts` globs `**/*.{format,delegate}.ts` under
  `tools/audit/`. `loader.ts` wires `loadFormatSpecFiles` /
  `loadDelegateSpecFiles` into the merged loader.
- Inline in `.regentrc.ts` via `rules.format[]` / `rules.delegate[]`
  is supported at the surface but not the primary path.
- Auto-detect when no specs are configured: `*.sln` → suggest dotnet,
  `package.json` → suggest node, `pyproject.toml` → suggest python.
  [#101](https://github.com/dot-stbl/regent/pull/101) (`fc18892`).

[#34](https://github.com/dot-stbl/regent/issues/34) ·
[#33](https://github.com/dot-stbl/regent/issues/33).

### Deferred to v0.6.0

- **34b — runner + safe invocation + output pipeline.** Two-tier
  output normalisation (parser in bundle for common tools, custom
  parser in spec for internal tools). Synthetic workspace-level
  finding on tool failure. Token blocklist (`--watch`, `--serve`,
  `--port`, `--listen`, `--dev`, `--daemon`, `serve`, `start`,
  `daemon`) + first-token denylist (`vite`, `next`, `gatsby`, `ng`,
  `webpack-dev-server`). Lives on
  `feat/config-plugins-34c-format-delegate-discovery-bundles-autodetect`
  as `6b60613`.

### Added — pattern helpers for Java, Go, Rust

- Twelve new helpers in the `patterns` namespace:
  - **Java:** `javaPublicClass`, `javaSystemOut`, `javaOverride`
  - **Go:** `goPackageDecl`, `goImport`, `goFuncMain`, `goPrintln`,
    `goPanic`
  - **Rust:** `rustPubFn`, `rustUseCrate`, `rustUnsafe`, `rustUnwrap`
- Migrates every shipped Java / Go / Rust example `.lint.ts` to
  consume the matching helper so the example packs demonstrate the
  helper API the way C# / TypeScript examples already did.
- Closes [#28](https://github.com/dot-stbl/regent/issues/28),
  [#29](https://github.com/dot-stbl/regent/issues/29),
  [#30](https://github.com/dot-stbl/regent/issues/30).
  [#92](https://github.com/dot-stbl/regent/pull/92),
  [#93](https://github.com/dot-stbl/regent/pull/93),
  [#94](https://github.com/dot-stbl/regent/pull/94).

### Added — JSDoc on `src/core/` public API

- Every public class + method in `src/core/{cache, dag, diff,
  benchmark, scanner, scanner-matcher, scanner-defaults}.ts` now
  carries a `/** */` block (purpose + `@param` / `@returns` where
  the signature isn't self-evident, `@throws` for known failures).
  IDE hover and the emitted `.d.ts` carry the prose; tsc preserves
  JSDoc in declarations.
  [#31](https://github.com/dot-stbl/regent/issues/31) →
  [#90](https://github.com/dot-stbl/regent/pull/90) (`438123f`).

### Cleanup — single source of truth for shipped-example prose

- Removes 6 dead-on-arrival sibling `.md` files under
  `examples/{rust, java, go}/<rule>.md`. They were created by #71
  alongside the canonical prose at
  `assets/llm/examples/<lang>/<id>.md` (the loader's path via
  `regent llm examples <lang>.<rule>`). Nothing was reading them,
  and after the helper migrations in #92–#94 they had drifted from
  the canonical content. C#/TS/Python never carried the duplicate.
  [#95](https://github.com/dot-stbl/regent/pull/95) (`70aa721`).

### Submodule state

- `assets/stbl` brand submodule: on the `dot-stbl/.github`
  repository (404 → `vc9789d0` at this sync). Previously a fresh
  checkout needed `git submodule update --init assets/stbl` before
  running tests locally — the four `assets.test.ts` failures in
  v0.4.0's "pre-existing" list disappeared once that was done. CI
  uses `submodules: recursive` (`ci.yml`, `release.yml`) so CI was
  unaffected; this is a local-only state.

### Test stats

- 664 tests across 70 files pass on `main` (per CI, ubuntu-latest).
  Up from v0.4.0's 537 / 537 (+127 from the config-plugins/33–34
  epic and the cross-language pattern helpers in #92–#94).
- `describe.test.ts` and `plugin-load.test.ts` share a
  `node_modules/@scope/regent-rules-test` symlink fixture; their
  `beforeAll`/`afterAll` lifecycles can race under vitest's default
  threaded pool on macOS / Windows. Run with
  `bun run test --sequence.shuffle=false` (or
  `vitest --sequence.shuffle=false`) for deterministic local
  results. CI (Linux, ubuntu-latest) is unaffected.

## v0.4.0 — fix-mode epic

Released 2026-07-21.

This release ships the **fix-mode epic** (#7) — the agent-loop story
end to end. Regent now ships a deterministic `applyFixes` engine
plus a `regent fix` CLI that agents consume in their loop.

### Added — fix-mode epic (#7)

#### Rule fix attachment (`RuleFixSpec`)

- `RuleFixSpec` discriminated union with four kinds:
  - `replace` — template-driven edits with capture-group expansion
    (`$1`, `${name}`, `$$`).
  - `delete-line` — drop the matched line + trailing newline.
  - `function` — programmatic edit producing `{ start, end, replacement }[]`.
  - `guidance-only` — no edit, just a `guidance` string surfaced to
    the agent. **Never** auto-applied, regardless of `--unsafe` / `--all`.
- `RuleFixSpec.safety: 'safe' | 'suggested'`. `'safe'` is auto-applied
  in the default lane; `'suggested'` requires `--unsafe` and is
  surfaced in `suggested[]`.
- `RuleFixSpec.converges?: boolean` — opt-in flag for fixpoint
  participation (P4). Rules that aren't mechanically idempotent
  MUST leave this unset.
- `validateFixSpec` runtime helper + Zod `RuleFixSpecSchema` for
  schema-time validation in `defineRule`.
- Tests: 9 in `test/kinds/fix-spec.test.ts`, 5 in
  `test/kinds/fix-loader.test.ts`.

[#58](https://github.com/dot-stbl/regent/issues/58) ·
[#73](https://github.com/dot-stbl/regent/pull/73) (`9c756b8`).

#### `applyFixes` engine (`src/fixer.ts`)

- Reads each affected file once, computes per-finding edits from the
  rule's `fix` attachment, sorts by `start` ascending, applies
  **left-to-right**. Overlapping edits defer into `deferred[]` with
  `reason: 'overlap'` and the winning ruleId.
- Per-finding rule lookup (a single file can host findings from
  many rules; the engine looks up `rule` + `fileFix` per finding).
- Pure / deterministic. Re-running `applyFixes` with the post-fix
  findings yields zero applied edits.
- Tests: 13 in `test/fixer.test.ts` (expandTemplate, replace /
  delete-line, right-to-left apply on same-line edits, overlap
  deferral, template capture-group expansion, dry-run, idempotency,
  suggested-lane routing, guidance-only routing, end-to-end
  fixture).

[#59](https://github.com/dot-stbl/regent/issues/59) ·
[#74](https://github.com/dot-stbl/regent/pull/74) (`1e2e395`).

#### Fixpoint loop

- After applying edits, re-scans each changed file against the
  converging rule set. If new findings emerge, runs again until
  convergence or `maxPasses` budget exhausted.
- Default `maxPasses: 5`, hard cap 20. Exceeding throws
  `ApplyFixesConvergenceError` with per-file stats.
- `ApplyFixesResult.passes: number` — actual iteration count.

[#61](https://github.com/dot-stbl/regent/issues/61) ·
[#77](https://github.com/dot-stbl/regent/pull/77) (`3649ef9`).

#### `regent fix` CLI (`src/cli/fix.ts`)

```sh
regent fix [paths...]                        # default: cwd
  --dry-run                                  # show diff, do not write
  --unsafe                                   # also apply suggested + function-form
  --all                                      # DEPRECATED alias for --unsafe
  --rule <id>                                # repeatable, restrict to listed rule ids
  --filter <glob>                            # restrict to file paths matching glob
  --format text|json                         # default text; json emits v1 wire
  --max-passes <n>                           # fixpoint iterations (default 5)
  --json                                     # DEPRECATED alias for --format json
  -y, --yes                                  # skip confirmation prompt
```

- Exit code: 0 if all findings either applied or surfaced as
  suggested; 1 if there were deferred edits with `reason` ∈
  `{overlap, out-of-range}`.
- `--unsafe` is the canonical flag going forward; `--all` prints a
  stderr deprecation warning and emits the same result.
- Tests: 9 in `test/cli-fix.test.ts`.

[#60](https://github.com/dot-stbl/regent/issues/60) ·
[#76](https://github.com/dot-stbl/regent/pull/76) (`ad139e2`).

#### v1 JSON wire format (`--format json`)

```jsonc
{
  "applied":   [{ "ruleId", "file", "range", "title", "before", "after" }],
  "suggested": [{ "ruleId", "file", "range", "title", "guidance",
                  "proposedEdit" | null, "context": ["…±3 lines…"] }],
  "deferred":  [{ "ruleId", "file", "range", "reason":
                  "overlap with <ruleId>" }]
}
```

- Top-level: ONLY `applied / suggested / deferred`. Stable so agents
  can branch on shape.
- `DeferredEdit.winningRuleId` threads up the rule that won the
  overlap.
- Schema artifact at `assets/llm/schema/fix-v1.json` (JSON Schema
  2020-12). `regent llm schema fix` renders it.
- 22 schema-validation cases in `test/fixer-json-schema.test.ts`.

[#62](https://github.com/dot-stbl/regent/issues/62) ·
[#78](https://github.com/dot-stbl/regent/pull/78) (`8ee749f`).

#### Golden snapshot tests

- 8 fixtures under `test/__fixtures__/fix-snapshots/` pin the v1 wire
  shape against the actual `applyFixes` output.
- `REGENT_UPDATE_SNAPSHOTS=1` is the only escape hatch to rewrite
  snapshots — guards against silent regressions.
- Path normalisation via `<cwd>` placeholder so committed snapshots
  stay host-agnostic.
- Tests: 8 in `test/fix-snapshots.test.ts`.

[#63](https://github.com/dot-stbl/regent/issues/63) ·
[#81](https://github.com/dot-stbl/regent/pull/81) (`764f070`).

#### Function-form fixes

- Function-form edits are routed through `tryRunFunction` with
  try/catch — a buggy function-fix does not crash the run.
- Function-form participates in the same overlap-deferral logic as
  declarative fixes.
- Gated behind `--unsafe` (the canonical name) or `--all` (deprecated
  alias). `guidance-only` is **never** applied, regardless of flags.
- Pure + deterministic contract documented in CONTRIBUTING.md.

[#64](https://github.com/dot-stbl/regent/issues/64) ·
[#80](https://github.com/dot-stbl/regent/pull/80) (`7629d4b`).

#### End-to-end integration tests

- 8 cases in `test/cli-fix-integration.test.ts` exercise the full
  `regent fix` pipeline against real example fixtures:
  - configure-await end-to-end (replace kind)
  - configure-await round-trip idempotency
  - brace-style end-to-end (function kind, requires `--unsafe`)
  - suggested-lane without `--all`
  - suggested-lane with `--all`
  - dry-run
  - JSON schema conformance via `validateFixV1`
  - negative case (malformed config)

[#65](https://github.com/dot-stbl/regent/issues/65) ·
[#82](https://github.com/dot-stbl/regent/pull/82) (`87b96ab`).

#### Docs + examples

- README: "Writing a fix" section after "Writing a rule".
- CONTRIBUTING.md: "Authoring a fix" section covering the four kinds,
  safety semantics, template syntax, function-form contract.
- LLM authoring surface: `regent llm authoring fix` renders the v1
  prose; `assets/llm/authoring/fix.md` is the source.
- Per-rule LLM docs for the two shipped fixable rules:
  - `assets/llm/examples/csharp/async.configure-await.md`
  - `assets/llm/examples/csharp/exceptions.brace-style.md`
- `examples/csharp/__fixtures__/<rule>/fixed.cs` for both shipped
  fixable rules — literal `regent fix --yes --unsafe` output.

[#66](https://github.com/dot-stbl/regent/issues/66) ·
[#83](https://github.com/dot-stbl/regent/pull/83) (`6a8be48`).

### Added — other features since v0.3.0

- ANSI-aware line-wrap reporter (`src/reporter/wrap-ansi.ts`).
  [#56](https://github.com/dot-stbl/regent/issues/56) ·
  [#67](https://github.com/dot-stbl/regent/pull/67) (`c60ef79`).
- `regent check --watch` with chokidar + per-file cache invalidation.
  [#67](https://github.com/dot-stbl/regent/issues/67) ·
  [#67](https://github.com/dot-stbl/regent/pull/67) (`482d8d9`).
- `.transform.ts` rules + transform pipeline (`.transform-loader` +
  `transform-run`). [#69](https://github.com/dot-stbl/regent/issues/69) ·
  [#69](https://github.com/dot-stbl/regent/pull/69) (`bd3542a`).
- Pattern helpers for Rust / Java / Go.
  [#71](https://github.com/dot-stbl/regent/issues/71) ·
  [#71](https://github.com/dot-stbl/regent/pull/71) (`458cd34`).
- Migration guides: `docs/migrating-from-eslint.md`,
  `docs/migrating-from-biome.md`, `docs/migrating-from-prettier.md`.
  [#68](https://github.com/dot-stbl/regent/issues/68) ·
  [#68](https://github.com/dot-stbl/regent/pull/68) (`40922c6`).

### Changed

- TypeScript pinned to `5.9.3` (exact, no caret). The dependabot bump
  to `7.0.2` ([#5](https://github.com/dot-stbl/regent/pull/5)) is
  reverted because `typescript-eslint` 8.x has peer
  `typescript: >=4.8.4 <6.1.0` and crashes at runtime against TS 7.
  When typescript-eslint ships TS 7 support, the bump can be
  retried. [#75](https://github.com/dot-stbl/regent/pull/75) (`fdc5a92`).

### Test stats

- 530 / 535 tests pass. The five pre-existing failures are out of
  scope for v0.4:
  - `test/loader.test.ts:96` — see
    [#72](https://github.com/dot-stbl/regent/issues/72).
  - `test/assets.test.ts` × 4 — git submodule not initialised in
    worktrees; pre-existing on `main`.

### Known issues (NOT fixed in v0.4.0)

- [#79](https://github.com/dot-stbl/regent/issues/79) — every CLI
  subcommand crashes on **Windows** shutdown with a libuv
  `UV_HANDLE_CLOSING` assertion (exit code
  `3221226505`). Output is correct; only the exit code is
  corrupted. Affects Windows only; CI runs on Ubuntu so this is
  invisible to gates. Out of scope for the fix-mode epic; tracked
  separately.
- [#72](https://github.com/dot-stbl/regent/issues/72) — pre-existing
  `test/loader.test.ts:96` failure on `main`. Out of scope.

### v0.5 backlog (deferred from v0.4.0)

These issues were reassigned to the **v0.5** milestone. They are
substantial features, not bug fixes, and were not in scope for the
fix-mode epic:

- [#33](https://github.com/dot-stbl/regent/issues/33) — Parameterized
  rules (author-declared zod param schemas, config-supplied values).
- [#34](https://github.com/dot-stbl/regent/issues/34) — Delegate /
  format mode (orchestrate native formatters via user specs).
- [#35](https://github.com/dot-stbl/regent/issues/35) — Scopes /
  workspaces (per-subproject config for monorepos).
- [#57](https://github.com/dot-stbl/regent/issues/57) — AST engine
  follow-ups (`needsNative`, regex deprecation, tri-state,
  grammar-version).

Two items originally in the v0.5 backlog (#23, #31) were completed
post-v0.4.0; see the **Unreleased** section above.

## v0.3.0

Released 2026-07-21 (tag `24064e3`). Public baseline. See the v0.3.0
tag and the merged PRs at that point for the full change set.