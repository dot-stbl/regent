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

/** Match produced by the runner — line + column span. */
export interface Match {
  readonly startLine: number;       // 0-indexed
  readonly startColumn: number;     // 0-indexed
  readonly endLine: number;
  readonly endColumn: number;
  readonly matchText: string;
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
  /** Merged accept-list from layer 3 (repo) + layer 4 (local). */
  readonly acceptList: readonly AcceptEntry[];
  readonly totalSourceLayers: number;
}
