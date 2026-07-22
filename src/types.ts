/**
 * Public types for `regent` rules, configs, and findings.
 *
 * Rules live as `<topic>.md` + `<topic>.rule.ts` pairs in
 * `~/.agents/rules/<category>/` and `tools/audit/rules/`. The loader
 * auto-derives `RuleSpec.source` from the sibling `.md` if not set
 * explicitly.
 *
 * **Tri-state review:** some patterns match things that aren't always
 * violations. Authors mark the rule with `review.enabled = true`;
 * each finding then carries a `status` (`pending`, `accepted`, or
 * `violation`) + an optional `guidance` for the LLM / human reviewer.
 * Accepted findings are filtered out via the accept-list in
 * `tools/audit/config.{ts,local.ts}`; pending findings are surfaced
 * separately via `regent review`; violations fail CI as usual.
 */

/** Severity classification for a rule's findings. */
export type Severity = 'error' | 'warning' | 'suggestion';

/**
 * A single rule. Patterns use RE2 syntax — see
 * https://github.com/GoogleCloudPlatform/re2/blob/master/doc/syntax.txt.
 *
 * RE2 does not support backreferences or lookahead/lookbehind. Linear-time
 * matching eliminates ReDoS as a concern.
 */
export interface RuleSpec {
  /** Stable identifier, scoped under a category namespace (`csharp.no-region`). */
  readonly id: string;

  /** Severity for findings. Drives exit code + reporter color. */
  readonly severity: Severity;

  /** RE2 pattern string. Compile-time validated via re2-wasm. */
  readonly pattern: string;

  /**
   * Optional RE2 pattern; if a line matches BOTH `pattern` and `excludeWhen`,
   * the finding is suppressed. Use sparingly — excludeWhen is for known
   * false-positive shapes (override-methods, sealed classes).
   */
  readonly excludeWhen?: string;

  /** Glob patterns of files to scan. */
  readonly globs: readonly string[];

  /**
   * Glob patterns of files to exclude (matched against the absolute path).
   * Always populated with sensible defaults by the loader when omitted:
   * `node_modules`, `dist`, `bin`, `obj`.
   */
  readonly excludePaths?: readonly string[];

  /** Short human message shown in the text reporter. */
  readonly message: string;

  /**
   * Back-link to the `.md` prose this rule encodes. Auto-derived from
   * sibling `<basename>.md#<heading>` when omitted. SARIF exposes this
   * as `helpUri` so consumers can jump to the rationale.
   */
  readonly source?: string;

  /** Optional longer explanation shown above the context snippet. */
  readonly rationale?: string;

  /**
   * Review-mode configuration. When `enabled`, each matching finding is
   * tagged as `pending` review and surfaced via `regent review` rather
   * than failing CI directly.
   */
  readonly review?: RuleReviewSpec;

  /**
   * Optional auto-fix attachment. See {@link RuleFixSpec} for the
   * four-lane design (`replace` / `delete-line` / `function` /
   * `guidance-only`). The loader validates safety↔kind invariants
   * via {@link validateFixSpec}.
   */
  readonly fix?: RuleFixSpec;
}

/**
 * Marks a rule's findings as review candidates (tri-state handling).
 *
 * Review rules do NOT fail CI on their own. The runner tags matching
 * findings as `status: 'pending'` and emits them in the review section.
 * Agents or humans triage via `regent accept` / `regent reject`, which
 * mutate the loaded accept-list.
 */
export interface RuleReviewSpec {
  /** Marks findings as review candidates rather than auto-failures. */
  readonly enabled: boolean;

  /**
   * Human/LLM instruction: what should the reviewer actually look at?
   * Surfaced as `regent review` markdown body + SARIF `properties.guidance`.
   */
  readonly guidance?: string;

  /**
   * `'no-fail'` (default): review findings never affect exit code.
   * `'unreviewed-fails'`: any unaccepted pending finding from this
   * rule fails CI at exit-on >= rule.severity. Acceptance via
   * `regent accept` clears the failure.
   */
  readonly exitBehavior?: 'no-fail' | 'unreviewed-fails';
}

/**
 * A single accept-list entry: silences pending-review findings for the
 * `(ruleId, path, optional line)` triple. Reasons are mandatory for
 * audit trail — without a reason, `regent accept` refuses the entry.
 */
export interface AcceptEntry {
  readonly ruleId: string;
  /** Glob pattern matched against the absolute file path. */
  readonly path: string;
  /** Omit to silence every match in the path; set to a specific line otherwise. */
  readonly line?: number;
  /** Free-text, max 500 chars. Required. */
  readonly reason: string;
}

/**
 * Safety lane for a `RuleFixSpec`:
 * - `'safe'`: deterministic, semantics-preserving; `regent fix`
 *   applies the edit without opt-in.
 * - `'suggested'`: requires `--unsafe` to apply, or the LLM agent
 *   applies judgement per item (per the agent JSON schema in P5).
 */
export type RuleFixSafety = 'safe' | 'suggested';

/**
 * Discriminated union for the optional `fix` field on a `RuleSpec`.
 *
 * Run-time application lands in P2 (`fixer.ts`); the data model is
 * locked in here so P5 (JSON agent schema) and P6 (SARIF emission)
 * can wire their shape without a breaking change.
 */
export type RuleFixSpec =
  | RuleFixReplace
  | RuleFixDeleteLine
  | RuleFixFunction
  | RuleFixGuidanceOnly;

interface RuleFixBase {
  /**
   * `safe` → auto-applied by `regent fix`. `suggested` → surfaced
   * via JSON / SARIF; never auto-applied without `--unsafe`.
   */
  readonly safety: RuleFixSafety;

  /**
   * One-line description of the change. Shown in dry-run / diff
   * output and as the SARIF `fix.description.text`.
   */
  readonly title: string;

  /**
   * For the agent: when NOT to apply, or what judgement is required.
   * Surfaced in `applied` / `suggested` blocks per the P5 schema.
   */
  readonly guidance?: string;

  /**
   * Opt-in flag for the fixpoint loop (Phase 4 of the fix-mode epic,
   * #7). When `true`, the rule participates in `applyFixes`'s
   * per-file re-scan: after the engine applies the rule's edit, the
   * file content is re-detected and any new findings for converging
   * rules are applied too, until no edits are produced or `maxPasses`
   * is reached. Default: `false` — most rules are single-pass.
   *
   * Mark a rule `converges: true` ONLY when the fix is mechanically
   * idempotent — `delete-line`, or `replace` with a fixed template
   * whose replacement does not re-trigger detection. Rules whose
   * replacement can produce chained edits (e.g. formatter-style
   * transformations) MUST NOT set this flag; they would loop until
   * `maxPasses` is exhausted and `ApplyFixesConvergenceError` fires.
   */
  readonly converges?: boolean;
}

/**
 * `replace`: template-driven, matches `RuleSpec.pattern` and substitutes
 * `template`. `template` MAY be empty (means "delete the match").
 * `$1`, `$2`, … / `${name}` expand capture groups from `pattern`.
 */
export interface RuleFixReplace extends RuleFixBase {
  readonly kind: 'replace';
  readonly template: string;
  /**
   * Restrict replacement to a capture group span instead of the
   * whole match. Undefined → the full match is replaced.
   */
  readonly targetGroup?: number | string;
}

/**
 * `delete-line`: deletes the matched line(s) (and the trailing `\n`).
 * `alsoDeleteMatching` removes a paired line matching the given
 * RE2 pattern (e.g. `#endregion` next to `#region`).
 */
export interface RuleFixDeleteLine extends RuleFixBase {
  readonly kind: 'delete-line';
  readonly alsoDeleteMatching?: string;
}

/**
 * `function`: programmatic. `apply(ctx) → FixEdit[] | null` MUST be
 * pure + deterministic. Returning `null` declines the rewrite.
 *
 * The function-form is reserved for cases the declarative shape
 * can't express; the cache keying for this kind is hashed on the
 * rule id + file content (same as the other kinds).
 */
export interface RuleFixFunction extends RuleFixBase {
  readonly kind: 'function';
  /**
   * Pure + deterministic transformer. Implementation passes via the
   * `defineRule` wrapper which erases the function from the on-disk
   * JSON shape; inline `rules.fix[]` entries without a function are
   * silently dropped (see P2 acceptance).
   */
  readonly apply: (ctx: RuleFixContext) => readonly RuleFixEdit[] | null;
}

/**
 * `guidance-only`: no edit. `regent fix` surfaces the `title` +
 * `guidance` in the agent's `suggested` block; the agent decides
 * whether to apply. This lane is the only one valid for `safety:
 * 'suggested'` without an `--unsafe` opt-in.
 */
export interface RuleFixGuidanceOnly extends RuleFixBase {
  readonly kind: 'guidance-only';
}

/**
 * Input to a `RuleFixFunction.apply`. Implementation-agnostic — the
 * function receives the file path + content and returns a list of
 * edits, each spanning a byte range. Returning `null` declines.
 */
export interface RuleFixContext {
  readonly filePath: string;
  readonly content: string;
}

/**
 * A single edit produced by a `RuleFixFunction.apply`. Offsets are
 * file-absolute byte positions.
 */
export interface RuleFixEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/**
 * Validate a `RuleFixSpec` for safety↔kind invariants:
 * - `safe` MUST carry a concrete `kind` (replace / delete-line /
 *   function). `guidance-only` MUST be `suggested`.
 *
 * Returns `true` on success; returns an error message string when
 * the fix violates the contract. The loader calls this and fails
 * loud on `string` return.
 */
export function validateFixSpec(
  fix: RuleFixSpec,
): true | string {
  if (fix.safety === 'safe' && fix.kind === 'guidance-only') {
    return 'safe fixes must carry a concrete kind (replace / delete-line / function); guidance-only is suggested-only';
  }
  if (fix.safety === 'suggested' && fix.kind === 'guidance-only') {
    return true;
  }
  if (fix.safety === 'suggested') {
    return true;
  }
  // safety === 'safe' + concrete kind
  switch (fix.kind) {
    case 'replace':
    case 'delete-line':
    case 'function':
      return true;
    case 'guidance-only':
      // unreachable: handled above
      return 'unreachable';
  }
}

/**
 * Per-rule severity / message override in `config.rules.override`.
 * Other fields from RuleSpec are not overrideable through config;
 * rules are modified by editing the source `.rule.ts` directly.
 */
export interface RuleOverride {
  readonly severity?: Severity;
  readonly message?: string;
}

/**
 * Configurable layer of the discovery hierarchy. Loaded from
 * `<repo>/tools/audit/config.ts` (committed) or `config.local.ts`
 * (gitignored).
 */
export interface ConfigLayer {
  /** Path / glob / preset ref to inherit rules from. */
  readonly extends?: readonly (string | readonly RuleSpec[])[];

  readonly rules?: {
    /** Rule IDs to drop from the merged set. */
    readonly disable?: readonly string[];

    /** Per-rule severity / message overrides. */
    readonly override?: Readonly<Record<string, RuleOverride>>;

    /**
     * Per-rule accept list for review-mode rules. Each entry silences
     * matching pending findings; if a `path` is met, no entry matches.
     * `path` is a glob; `line` pins to a specific line if set.
     */
    readonly accept?: readonly AcceptEntry[];

    /** Project-specific rules to add to the merged set. */
    readonly add?: readonly RuleSpec[];
  };
}

/** A compiled rule ready for execution — pattern + excludeWhen compiled via re2-wasm. */
export interface CompiledRule {
  readonly spec: RuleSpec;
  readonly source: string;
  /** Original file the rule was defined in, for diagnostics. */
  readonly origin: RuleOrigin;
}

export type RuleOrigin =
  | { readonly kind: 'preset'; readonly preset: string }
  | { readonly kind: 'global'; readonly path: string }
  | { readonly kind: 'repo'; readonly path: string }
  | { readonly kind: 'local'; readonly path: string };

/** Match produced by the runner — line + precise column span. */
export interface Match {
  readonly startLine: number;       // 0-indexed
  /** 0-indexed byte offset of the match start within the line. */
  readonly startColumn: number;
  readonly endLine: number;
  /** 0-indexed byte offset one past the match end within the line. */
  readonly endColumn: number;
  /** Full line text containing the match (used by reporters + redaction). */
  readonly matchText: string;
  /**
   * Capture-group VALUES (group 1..n) of the first match on the line;
   * null for a non-participating group. Group *offsets* are not provided —
   * re2-wasm exposes no `d`-flag `.indices`, so values suffice for template
   * expansion and spans are derived by the fix engine only when needed.
   */
  readonly groups?: readonly (string | null)[];
}

/** Context window extracted around a match. */
export interface ContextWindow {
  readonly startLine: number;       // 0-indexed, may be clamped to file
  readonly endLine: number;         // inclusive, may be clamped to file
  readonly lines: readonly string[];
}

/**
 * Tri-state of a finding in the review pipeline.
 * - `pending`: rule fired, not yet triaged; surface via `regent review`.
 * - `accepted`: matched the accept-list; filtered out from output.
 * - `violation`: review rule with `exitBehavior: 'unreviewed-fails'` and no
 *   accept match, OR non-review rule with severity failing CI.
 */
export type FindingStatus = 'pending' | 'accepted' | 'violation';

/**
 * Final finding — a single match surfaced to a reporter.
 *
 * `status` is assigned by the runner from accept-list + rule.review;
 * `review.guidance` is copied from the rule when present.
 */
export interface Finding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly path: string;
  readonly match: Match;
  readonly context: ContextWindow;
  readonly message: string;
  readonly source: string;
  readonly rationale?: string;

  /** Tri-state triage position. Default for non-review rules: 'violation'. */
  readonly status: FindingStatus;

  /** Review-mode metadata (only present on review-rule findings). */
  readonly review?: {
    readonly guidance?: string;
    /** 'unreviewed-fails' | 'no-fail'. Default: 'no-fail'. */
    readonly exitBehavior: 'no-fail' | 'unreviewed-fails';
  };

  /** Reason captured if status === 'accepted' (audit trail). */
  readonly acceptedReason?: string;
}

/** What the runner is asked to scan. */
export interface RunnerScope {
  readonly cwd: string;
  readonly includeGlobs: readonly string[];
  readonly excludeGlobs: readonly string[];
  readonly changedOnly: boolean;
  readonly diffBase: string;
}

/** Result of evaluating every applicable rule across every file. */
export interface RunResult {
  readonly findings: readonly Finding[];
  readonly rules: readonly CompiledRule[];
  readonly scannedFiles: number;
}

/** Result of loading rules — extended with accept-list (used by runner). */
export interface LoaderRuleSet {
  readonly rules: readonly CompiledRule[];
  /**
   * Pre-materialisation snapshots of every parameterised rule
   * (#33 + #33c). The live `params` schema is dropped from the
   * materialised `RuleSpec` in `rules[]`; this list keeps the
   * pre-materialisation shape so `regent describe` can render the
   * JSON Schema and a sample `rules.configure` block. Empty for
   * rule sets with no parameterised rules.
   */
  readonly parameterisedRules: readonly import('./loader/parameterize.js').ParameterisedRuleSnapshot[];
  /** Merged accept-list from layer 3 (repo) + layer 4 (local). */
  readonly acceptList: readonly AcceptEntry[];
  readonly totalSourceLayers: number;
}
