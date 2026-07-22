# Authoring fix rules (v1)

The v1 fix surface replaces the v0.2 string-form-only shape with a
discriminated union of four `RuleFixSpec` kinds, two safety lanes, and
an opt-in fixpoint flag. This guide is the long form; the README
"Writing a fix" section is the short form.

## The four `RuleFixSpec` kinds

`RuleFixSpec` is a discriminated union on `kind`:

| `kind` | Shape | When to use |
|--------|-------|-------------|
| `replace` | `{ kind: 'replace', template: string }` | Match → substitute (template may be empty = delete the match). `$1`, `$2`, `${name}`, `$$` expand capture groups. |
| `delete-line` | `{ kind: 'delete-line', alsoDeleteMatching?: string }` | Match → drop the matched line (and the trailing newline). `alsoDeleteMatching` drops a paired line matching an RE2 pattern (e.g. `#endregion` next to `#region`). |
| `function` | `{ kind: 'function', apply: (ctx) => FixEdit[] \| null }` | Programmatic. Returns a list of byte-span edits OR `null` to decline. The shape declarative kinds can't express. |
| `guidance-only` | `{ kind: 'guidance-only' }` | No edit. Surfaces the `title` + `guidance` in the agent's `suggested[]` block — the agent (or a human) applies judgement. The only valid kind for `safety: 'suggested'` without an explicit `--unsafe`. |

### Templates (`replace.kind === 'replace'`)

```ts
fix: { kind: 'replace', safety: 'safe', title: 'csharp.swap-foo-bar', template: '$2-$1' }
```

Template syntax:

| Token | Meaning |
|-------|---------|
| `$1`, `$2`, … | Numeric capture group (1-indexed). |
| `${name}` | Named capture group (when the runner exposes groupsByName). |
| `$$` | Literal `$` (escape). |

Unresolved references (e.g. `$99` when only 3 groups exist) are left
as-is in the output — the user spots the failure in the diff rather
than silently dropping the reference.

## Safety lanes

Every `RuleFixSpec` carries `safety: 'safe' | 'suggested'`:

| `safety` | What `regent fix` does |
|----------|------------------------|
| `'safe'` | Auto-applies the edit in the safe lane. No opt-in. |
| `'suggested'` | Surfaces the edit in `suggested[]` (text + JSON). To apply, the user passes `--unsafe` (CLI) or `lane: 'all'` (library), OR an agent applies per-item judgement against the wire-format `suggested[]` block. |

`guidance-only` fixes are always suggested (their entire purpose is
the human/agent judgement step) and never auto-apply even with
`--unsafe`.

The loader enforces `safety` ↔ `kind` invariants at startup:
`{ safety: 'safe', kind: 'guidance-only' }` is rejected. All other
combinations are accepted.

## The `converges` flag — fixpoint-loop opt-in (P4)

```ts
fix: { kind: 'delete-line', safety: 'safe', title: 'meta.strip-trailing-blank', converges: true }
```

`converges: true` opts the rule into `applyFixes`'s fixpoint re-scan:
after each pass, the engine re-detects the changed file and re-applies
any new findings whose rule also opted in. The loop stops when no
edits are produced, when `maxPasses` (default 5, hard cap 20) is
exceeded, or when the run produces an identical pass set (idempotence
guard).

**Default: `false`** — most rules are single-pass. Mark `converges: true`
ONLY when the fix is mechanically idempotent: `delete-line`, or
`replace` with a fixed template whose replacement doesn't re-trigger
detection. Rules whose replacement can produce chained edits MUST NOT
set this flag; they'd loop until `maxPasses` is exhausted and
`ApplyFixesConvergenceError` fires.

## Pure + deterministic contract for `function`-kind fixes

`RuleFixFunction.apply(ctx) → FixEdit[] | null` MUST be:

- **Pure**: no I/O, no global state mutation, no time / randomness / clock reads.
- **Deterministic**: same `(ctx)` → same return value. Required so the
  cache keying + the fixpoint loop are reproducible; CI diffs are
  byte-stable for the same input + rule set.

Returning `null` declines the rewrite (no edit produced, no surface in
`applied`/`suggested`). Returning `[]` is a valid empty result — no
edits to apply, but no decline. If the function throws, the engine
catches the exception, logs a one-line warning to stderr, and drops
that rule's edits for the rest of the run.

This contract lets the engine run the fixpoint loop deterministically
and makes CI-applied diffs reproducible for users reviewing the same
input and rule set.

## Recommendation: keep `safe` small

`safe` is the lane the CLI auto-applies. Keep it for edits that are
**mechanically semantics-preserving** — `.ConfigureAwait(false)` is a
no-op in app code; a `delete-line` for a paired region block is a
text-level rewrite. Anything that requires judgement (refactors,
semantic rewrites, deletes of unclear intent) belongs in
`safety: 'suggested'` so the agent or human reviews the diff before
applying.

## Adding a `fixed.<ext>` to your fixture

Every shipped fixable rule carries a `{bad,good,fixed}.<ext>` triple
under `examples/<lang>/__fixtures__/<rule>/`. `fixed.<ext>` is the
**literal engine output**, not a human-cleaned shape — it equals what
`regent fix` produces against `bad.<ext>` in a tmpdir.

To regenerate `fixed.<ext>` after a rule change:

1. Copy `bad.<ext>` to a scratch directory.
2. Copy the rule's `.lint.ts` into the same directory's
   `tools/audit/rules/`.
3. Run `node dist/cli.js fix --yes` (add `--unsafe` if the rule's
   `kind` is `function`).
4. Read the on-disk file back. That IS `fixed.<ext>`.

`good.<ext>` may differ from `fixed.<ext>` — `good.<ext>` is the
human-cleaned final shape (with the chain collapsed onto one line,
imports reordered, etc.), while `fixed.<ext>` is the literal
mechanical output. The shipped-examples test asserts `fixed.<ext>`
equals engine output, NOT `good.<ext>`.

## See also

- README "Writing a fix" — the short form.
- `src/types.ts` — `RuleFixSpec`, `RuleFixReplace`, `RuleFixDeleteLine`,
  `RuleFixFunction`, `RuleFixGuidanceOnly`, `validateFixSpec`.
- `assets/llm/schema/fix-v1.json` — the `regent fix --format json`
  output schema (the wire format agents consume).
- `assets/llm/examples/<lang>/<rule>.md` — per-shipped-rule docs that
  pick a `safety` lane and show the bad → fixed diff.
