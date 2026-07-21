/**
 * fixer.ts — the applyFixes engine (Phase 2 + 4 of the fix-mode epic, #7).
 *
 * Reads each changed file once, computes a per-finding edit from
 * the rule's `fix` attachment, applies edits in a single right-to-left
 * pass per file, and writes the result back. Edits that conflict with
 * a higher-priority edit are deferred (returned, not applied) per
 * the design in #7 §7.
 *
 * Current fix lanes:
 * - `replace` and `delete-line` apply in the safe lane when declared safe.
 * - `function` fixes are suggested by default and apply only in the all
 *   lane selected by `regent fix --unsafe`.
 * - `guidance-only` fixes are always suggested and never applied.
 * - Right-to-left application: edits sorted by `start` ascending,
 *   applied from highest offset downward so earlier offsets stay
 *   valid.
 *
 * Phase 4 (this commit) adds the **fixpoint loop** on top of P2:
 * - Per-rule opt-in `converges: true` flag on `RuleFixSpec` — only
 *   rules that explicitly opt in participate in the re-scan after
 *   pass 1 (most rules are single-pass).
 * - `ApplyFixesOptions.maxPasses` (default 5, hard cap 20) bounds
 *   the re-scan iterations; exceeding it throws
 *   `ApplyFixesConvergenceError` carrying per-file stats.
 * - `ApplyFixesResult.passes` reports the iteration count actually
 *   performed (1 = single pass; > 1 = fixpoint fired).
 *
 * Pure functions over `(content, edits)`; the file I/O is
 * isolated to `applyFixes` itself.
 */

import { readFile, writeFile } from 'node:fs/promises';

import { detectFile } from './runner.js';
import type { CompiledRule } from './types.js';
import type {
  Finding,
  Match,
  RuleFixContext,
  RuleFixEdit,
  RuleFixFunction,
  RuleFixReplace,
  RuleFixSpec,
  RuleSpec,
} from './types.js';

/** Default + hard cap for the fixpoint iteration budget (Phase 4, #7). */
export const APPLY_FIXES_DEFAULT_MAX_PASSES = 5;
export const APPLY_FIXES_MAX_PASSES_CAP = 20;

export interface ApplyFixesOptions {
  readonly cwd: string;
  /**
   * When `true`, do not write to disk; only return the diff and the
   * list of would-be applied edits.
   */
  readonly dryRun?: boolean;
  /**
   * Which lane to apply. Default: `'safe'`. `'all'` includes
   * `function`-kind (P7) and is reserved for `--unsafe` invocation.
   */
  readonly lane?: 'safe' | 'all';
  /**
   * Maximum fixpoint iterations (Phase 4 of #7). The engine re-runs
   * detection against the post-edit content of each affected file
   * after each pass, and re-applies any new findings for rules that
   * opted in via `RuleFixSpec.converges: true`. The loop stops when
   * a pass produces no edits, when no converging findings remain,
   * or when this cap is reached.
   *
   * Default: 5. Hard cap: 20 (clamped — values above are silently
   * lowered to 20 to bound memory + CPU). Pass `1` to disable the
   * fixpoint entirely (single-pass semantics).
   *
   * Throws `ApplyFixesConvergenceError` when the cap is reached with
   * converging findings still pending.
   */
  readonly maxPasses?: number;
  /**
   * Per-file accept-list for the fixpoint re-scan. Defaults to `[]`
   * (no accept-list). The initial detection's accept-list is applied
   * by the runner before findings reach `applyFixes`; this field is
   * the re-scan's view so the same triage repeats consistently.
   */
  readonly acceptList?: readonly { readonly ruleId: string; readonly path: string; readonly line?: number; readonly reason: string }[];
  /**
   * Lines of context included before/after each match in the
   * fixpoint re-scan's findings. Defaults to `3` (the runner's
   * `DEFAULT_CONTEXT_BUFFER`).
   */
  readonly contextBuffer?: number;
}

export interface AppliedEdit {
  readonly ruleId: string;
  readonly file: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly before: string;
  readonly after: string;
  readonly title: string;
}

export interface DeferredEdit {
  readonly ruleId: string;
  readonly file: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly reason: 'overlap' | 'out-of-range' | 'no-fix-attached';
  readonly title?: string;
  /**
   * When `reason === 'overlap'`, the ruleId of the earlier-registered
   * edit that won the contested byte span. Surfaced in the v1 wire
   * format (`regent fix --format json`) as the suffix on `reason`
   * — `"overlap with <winningRuleId>"` — so the agent can read the
   * conflict directly (P5 of the fix-mode epic, #62).
   *
   * `undefined` for `out-of-range` and `no-fix-attached` (no winning
   * rule to name).
   */
  readonly winningRuleId?: string;
}

export interface SuggestedEdit {
  readonly ruleId: string;
  readonly file: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly title: string;
  readonly guidance: string | undefined;
  readonly proposedEdit: { readonly start: number; readonly end: number; readonly replacement: string } | null;
}

export interface ApplyFixesResult {
  readonly applied: readonly AppliedEdit[];
  readonly changedFiles: readonly string[];
  readonly deferred: readonly DeferredEdit[];
  readonly suggested: readonly SuggestedEdit[];
  readonly unifiedDiff: string;
  /**
   * Number of fixpoint iterations actually performed. `1` means the
   * engine ran the initial pass and stopped (no re-scan needed);
   * `> 1` means at least one converging rule produced chained
   * edits that were re-applied. Surfaced by the CLI for visibility
   * — a non-trivial `passes` value means the loop did real work.
   */
  readonly passes: number;
}

/**
 * Thrown when `applyFixes` exhausts the `maxPasses` budget with
 * converging findings still pending (Phase 4 of #7). The
 * `stats` field carries the per-file diagnostic so the CLI can
 * pinpoint which rule + file is looping.
 *
 * The error message includes the stats inline for log-friendliness;
 * programmatic callers should read `stats` directly.
 */
export class ApplyFixesConvergenceError extends Error {
  readonly stats: {
    readonly file: string;
    readonly ruleId: string;
    readonly passCount: number;
    readonly lastAppliedCount: number;
  };

  constructor(
    message: string,
    stats: {
      readonly file: string;
      readonly ruleId: string;
      readonly passCount: number;
      readonly lastAppliedCount: number;
    },
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ApplyFixesConvergenceError';
    this.stats = stats;
  }
}

interface ApplyEditsResult {
  newContent: string;
  applied: { edit: RuleFixEdit; ruleId: string; title: string }[];
  /**
   * Overlap-deferred edits. `winningRuleId` records the ruleId of the
   * earlier-registered edit that won the contested byte span — the
   * P5 v1 wire format surfaces this in `deferred[].reason` as
   * `"overlap: <winningRuleId>"` so agents can read the conflict
   * without re-deriving it from byte ranges.
   */
  deferredOverlap: { edit: RuleFixEdit; ruleId: string; title: string; start: number; end: number; winningRuleId: string }[];
}

interface PassResult {
  applied: AppliedEdit[];
  deferred: DeferredEdit[];
  suggested: SuggestedEdit[];
  changedFiles: string[];
  unifiedDiff: string;
  /** Map of file → post-edit content (in-memory copy for the next pass's re-scan). */
  updatedContent: Map<string, string>;
}

/**
 * Compute the per-file byte offset for a line.
 *
 * `lineIndex` is 0-based. Returns the byte offset of the first byte
 * of that line. For line 0 the offset is 0; for line N it's the sum
 * of `lines[0..N-1].length + N` (the N comes from the `\n` chars
 * separating lines).
 */
function lineByteOffset(content: string, lineIndex: number): number {
  let offset = 0;
  let line = 0;
  for (let i = 0; i < content.length; i++) {
    if (line === lineIndex) {
      return offset;
    }
    if (content[i] === '\n') {
      line++;
      offset = i + 1;
    }
  }
  return offset;
}

/**
 * Convert a per-line match to a file-absolute byte span.
 */
function matchToByteSpan(content: string, match: Match): { start: number; end: number } {
  const lineStart = lineByteOffset(content, match.startLine);
  return {
    start: lineStart + match.startColumn,
    end: lineStart + match.endColumn,
  };
}

/**
 * Expand a `replace` template's capture-group references.
 *
 * Supports:
 * - `$1`, `$2`, … — numeric groups (1-indexed).
 * - `${name}` — named groups (currently resolved from
 *   `groupsByName`; P0 deliverable since the runner doesn't yet
 *   expose named groups, so the named branch is best-effort).
 * - `$$` — escape for a literal `$`.
 *
 * Unresolved references (e.g. `$99` when only 3 groups exist) are
 * left as-is in the output — the user can spot the failure in the
 * diff rather than have us silently drop the reference.
 */
const TEMPLATE_PATTERN = /\$\$|\$\{([^}]+)\}|\$(\d+)/g;

export function expandTemplate(
  template: string,
  groups: readonly (string | null)[],
  groupsByName?: Readonly<Record<string, string>>,
): string {
  return template.replace(TEMPLATE_PATTERN, (match, name, idx) => {
    if (match === '$$') {
      return '$';
    }
    if (name !== undefined) {
      const byName = groupsByName?.[name];
      return byName ?? match;
    }
    const i = Number.parseInt(idx, 10);
    const v = groups[i - 1];
    return v ?? match;
  });
}

/**
 * Build a `delete-line` edit from a match. The edit spans the entire
 * matched line (including the trailing `\n`). If the line is the last
 * in the file and has no newline, only the line content is removed.
 */
function deleteLineEdit(content: string, match: Match): RuleFixEdit {
  const start = lineByteOffset(content, match.startLine);
  // Find the end of the line (newline char or end-of-content).
  let end = start;
  while (end < content.length && content[end] !== '\n') {
    end++;
  }
  // Include the trailing newline if present.
  if (end < content.length && content[end] === '\n') {
    end += 1;
  }
  return { start, end, replacement: '' };
}

/**
 * Build a `replace` edit from a match + the rule's fix template.
 * Expands the template using the match's capture groups.
 */
function replaceEdit(
  content: string,
  match: Match,
  fix: RuleFixReplace,
): RuleFixEdit {
  const { start, end } = matchToByteSpan(content, match);
  const groups = match.groups ?? [];
  const replacement = expandTemplate(fix.template, groups);
  return { start, end, replacement };
}

/**
 * Compute the per-finding edit for the rule's `fix`. Returns
 * `null` for kinds the engine doesn't apply yet (P5 / P7).
 */
function computeEdit(
  content: string,
  match: Match,
  fix: RuleFixSpec,
): RuleFixEdit | null {
  switch (fix.kind) {
    case 'replace':
      return replaceEdit(content, match, fix);
    case 'delete-line':
      return deleteLineEdit(content, match);
    case 'function':
    case 'guidance-only':
      return null;
  }
}

/**
 * Sort edits by `start` ascending; for ties, the first-registered
 * edit (lower originalIndex) keeps priority. Returns the sorted list.
 * Caller iterates left-to-right so the first-registered edit on each
 * byte span is the one that wins, and a later edit overlapping it
 * is deferred as `overlap`.
 */
function sortEditsByStart(
  edits: ReadonlyArray<{ edit: RuleFixEdit; ruleId: string; title: string }>,
): { start: number; edit: RuleFixEdit; ruleId: string; title: string }[] {
  const indexed = edits.map((e, i) => ({ ...e, originalIndex: i }));
  indexed.sort((a, b) => {
    if (a.edit.start !== b.edit.start) {
      return a.edit.start - b.edit.start;
    }
    return a.originalIndex - b.originalIndex;
  });
  return indexed.map((e) => ({ start: e.edit.start, edit: e.edit, ruleId: e.ruleId, title: e.title }));
}

/**
 * Apply a list of edits to `content`. Each edit is a `{ start, end,
 * replacement }` triple. Returns the new content and the list of
 * edits that were ACTUALLY applied. Edits that overlap with a
 * higher-priority edit (one that wins by registration order on the
 * same byte span) are returned in `deferredOverlap` for the caller
 * to surface.
 *
 * Returns a tagged list (`applied` / `deferredOverlap`) so the
 * caller can look up the original ruleId and title for each
 * resulting record.
 */
function applyEditsToString(
  content: string,
  sorted: ReadonlyArray<{ start: number; edit: RuleFixEdit; ruleId: string; title: string }>,
): ApplyEditsResult {
  const applied: { edit: RuleFixEdit; ruleId: string; title: string }[] = [];
  const deferredOverlap: { edit: RuleFixEdit; ruleId: string; title: string; start: number; end: number; winningRuleId: string }[] = [];
  let result = '';
  let cursor = 0;
  let lastAppliedEnd = -1;
  let lastAppliedRuleId = '';

  for (const { edit, ruleId, title } of sorted) {
    if (edit.end > content.length) {
      // Skip out-of-range edits (no recovery — runner can re-scan).
      continue;
    }
    if (edit.start < lastAppliedEnd) {
      // Overlaps with a previously applied edit on this file. Defer.
      // Record which earlier-registered edit won the byte span so
      // the v1 wire format can surface `"overlap: <winningRuleId>"`
      // (P5 of the fix-mode epic, #62).
      deferredOverlap.push({
        edit,
        ruleId,
        title,
        start: edit.start,
        end: edit.end,
        winningRuleId: lastAppliedRuleId,
      });
      continue;
    }
    // Append the unchanged content before this edit, then the edit.
    if (cursor < edit.start) {
      result += content.slice(cursor, edit.start);
    }
    result += edit.replacement;
    cursor = edit.end;
    lastAppliedEnd = edit.end;
    lastAppliedRuleId = ruleId;
    applied.push({ edit, ruleId, title });
  }
  // Append the unchanged content after the last edit.
  if (cursor < content.length) {
    result += content.slice(cursor);
  }
  return { newContent: result, applied, deferredOverlap };
}

/**
 * Collect the ruleIds of converging fixes among the supplied
 * findings. The set is computed once from the *initial* findings and
 * used as the membership filter for every subsequent pass: only
 * rules whose fix carried `converges: true` participate in the
 * fixpoint re-scan (rules that didn't opt in are single-pass).
 *
 * Findings whose rule is missing from `rulesById` are skipped — they
 * would be deferred as `no-fix-attached` anyway, so they're not
 * part of the convergence set.
 */
function collectConvergingRuleIds(
  _findings: readonly Finding[],
  rulesById: ReadonlyMap<string, RuleSpec>,
): Set<string> {
  // The fixpoint needs every rule whose fix carries `converges: true`
  // — not just the ones that produced the initial findings. A rule
  // that didn't fire on pass 1 may fire on pass 2 if pass 1's edit
  // introduced its pattern (e.g. `foo → Foo` introduces a new match
  // for a rule matching `Foo`). Limiting the set to initial findings
  // would silently disable those chained transformations.
  const ids = new Set<string>();
  for (const [id, spec] of rulesById) {
    if (spec.fix?.converges === true) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Build the `CompiledRule[]` slice needed by `detectFile`'s re-scan
 * for a given set of converging ruleIds. Looks each one up in
 * `rulesById` and wraps it in a minimal `CompiledRule` (the runner
 * only reads `spec` / `source` from the compile step's input — the
 * `origin` is a placeholder).
 *
 * Missing ruleIds are silently dropped (a converging rule that the
 * caller omitted from `rulesById` cannot re-fire; that would be a
 * programmer error and the surface here is intentionally forgiving).
 */
function compileConvergingRules(
  rulesById: ReadonlyMap<string, RuleSpec>,
  convergingIds: ReadonlySet<string>,
): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const id of convergingIds) {
    const spec = rulesById.get(id);
    if (spec === undefined) {
      continue;
    }
    out.push({
      spec,
      source: spec.source ?? '<fixpoint>',
      origin: { kind: 'repo', path: '<fixpoint>' },
    });
  }
  return out;
}

/**
 * Run a single pass of the fix engine. Reads each affected file
 * (unless `contentOverrides` already supplies an in-memory copy from
 * the previous pass), computes per-finding edits, applies them,
 * writes back to disk (unless `dryRun`), and returns the per-file
 * post-edit content so the fixpoint loop can feed it back into the
 * next iteration without an extra disk read.
 *
 * Pure with respect to the fixpoint — this function knows nothing
 * about iteration counts; the caller (`applyFixes`) decides whether
 * to call it again.
 */
async function applyOnePass(
  findings: readonly Finding[],
  rulesById: ReadonlyMap<string, RuleSpec>,
  options: ApplyFixesOptions,
  contentOverrides: ReadonlyMap<string, string>,
): Promise<PassResult> {
  const dryRun = options.dryRun ?? false;
  const lane = options.lane ?? 'safe';

  // 1. Bucket findings by file.
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    if (f.status !== 'violation') {
      continue;
    }
    const list = byFile.get(f.path) ?? [];
    list.push(f);
    byFile.set(f.path, list);
  }

  const applied: AppliedEdit[] = [];
  const deferred: DeferredEdit[] = [];
  const suggested: SuggestedEdit[] = [];
  const changedFiles: string[] = [];
  const diffPieces: string[] = [];
  const updatedContent = new Map<string, string>();

  for (const [relPath, fileFindings] of byFile) {
    const absPath = relPath;

    let content: string;
    const override = contentOverrides.get(absPath);
    if (override !== undefined) {
      // Fixpoint re-scan fed us the in-memory post-edit content
      // from the previous pass — use it directly (skip the disk
      // read and avoid stale-content races on slow filesystems).
      content = override;
    } else {
      try {
        content = await readFile(absPath, 'utf8');
      } catch {
        // File unreadable; defer everything.
        for (const f of fileFindings) {
          deferred.push({
            ruleId: f.ruleId,
            file: relPath,
            range: { start: 0, end: 0 },
            reason: 'out-of-range',
          });
        }
        continue;
      }
    }

    // Build per-finding edits. Each finding has its own rule, so we
    // look up `rule` + `fileFix` per finding rather than once per file.
    // Function fixes run once per rule and file because their context
    // contains the whole file and may return multiple edits.
    const edits: { edit: RuleFixEdit; ruleId: string; title: string }[] = [];
    const processedFunctionRules = new Set<string>();
    for (const f of fileFindings) {
      const rule = rulesById.get(f.ruleId);
      const fileFix = rule?.fix;

      // No rule, no fix-attachment → surface as `deferred`
      // (no-fix-attached). The runner has already produced a `pending`
      // review candidate in that case.
      if (rule === undefined || fileFix === undefined) {
        deferred.push({
          ruleId: f.ruleId,
          file: relPath,
          range: { start: 0, end: 0 },
          reason: 'no-fix-attached',
        });
        continue;
      }

      const edit = computeEdit(content, f.match, fileFix);
      if (edit !== null) {
        if (fileFix.safety === 'suggested' && lane === 'safe') {
          suggested.push({
            ruleId: f.ruleId,
            file: relPath,
            range: { start: edit.start, end: edit.end },
            title: fileFix.title,
            guidance: fileFix.guidance,
            proposedEdit: {
              start: edit.start,
              end: edit.end,
              replacement: edit.replacement,
            },
          });
          continue;
        }
        // safety === 'suggested' && lane === 'all' falls through; apply.
        edits.push({ edit, ruleId: f.ruleId, title: fileFix.title });
      } else {
        if (fileFix.kind === 'function') {
          if (processedFunctionRules.has(f.ruleId)) {
            continue;
          }
          processedFunctionRules.add(f.ruleId);
          const fnFix = fileFix as RuleFixFunction;
          const functionEdits = tryRunFunction(fnFix, f.ruleId, absPath, content);
          if (functionEdits === null) {
            continue;
          }
          for (const functionEdit of functionEdits) {
            if (lane === 'all') {
              edits.push({ edit: functionEdit, ruleId: f.ruleId, title: fnFix.title });
            } else {
              suggested.push({
                ruleId: f.ruleId,
                file: relPath,
                range: { start: functionEdit.start, end: functionEdit.end },
                title: fnFix.title,
                guidance: fnFix.guidance,
                proposedEdit: {
                  start: functionEdit.start,
                  end: functionEdit.end,
                  replacement: functionEdit.replacement,
                },
              });
            }
          }
        } else {
          suggested.push({
            ruleId: f.ruleId,
            file: relPath,
            range: { start: 0, end: 0 },
            title: fileFix.title,
            guidance: fileFix.guidance,
            proposedEdit: null,
          });
        }
      }
    }

    if (edits.length === 0) {
      continue;
    }

    // 3. Sort edits by start ascending + apply left-to-right.
    const sorted = sortEditsByStart(edits);
    const { newContent, applied: fileApplied, deferredOverlap } = applyEditsToString(content, sorted);

    // 4. Write back (unless dry-run).
    if (!dryRun && newContent !== content) {
      try {
        await writeFile(absPath, newContent, 'utf8');
      } catch {
        // Write failed; defer all edits for this file.
        for (const e of fileApplied) {
          deferred.push({
            ruleId: '',
            file: relPath,
            range: { start: e.edit.start, end: e.edit.end },
            reason: 'out-of-range',
            title: e.edit.replacement,
          });
        }
        continue;
      }
    }

    if (newContent !== content) {
      changedFiles.push(relPath);
      // Generate a small diff entry: file path + count.
      diffPieces.push(`--- ${relPath} (${fileApplied.length} edit${fileApplied.length === 1 ? '' : 's'})`);
      // Stash the post-edit content for the fixpoint re-scan. In
      // dry-run mode this is the in-memory post-edit content; the
      // next pass's re-scan will pick it up via `contentOverrides`.
      updatedContent.set(relPath, newContent);
    }

    for (const { edit, ruleId, title } of fileApplied) {
      applied.push({
        ruleId,
        file: relPath,
        range: { start: edit.start, end: edit.end },
        before: content.slice(edit.start, edit.end),
        after: edit.replacement,
        title,
      });
    }
    for (const d of deferredOverlap) {
      deferred.push({
        ruleId: d.ruleId,
        file: relPath,
        range: { start: d.start, end: d.end },
        reason: 'overlap',
        title: d.title,
        winningRuleId: d.winningRuleId,
      });
    }
  }

  return {
    applied,
    changedFiles,
    deferred,
    suggested,
    unifiedDiff: diffPieces.join('\n'),
    updatedContent,
  };
}

/**
 * Top-level entry point. Read each affected file, compute + apply the
 * per-finding edits, write back. With `maxPasses > 1` (default 5),
 * re-scans each changed file against the same rule set after every
 * pass and re-applies any new findings whose rule opted into the
 * fixpoint via `RuleFixSpec.converges: true`.
 *
 * Idempotence contract (Phase 4 acceptance criterion #3): for any
 * mechanically-idempotent converging rule (e.g. `delete-line`,
 * template-driven `replace` whose template does not re-trigger
 * detection), running `applyFixes` twice yields zero edits on the
 * second pass — the post-fix-1 content is the same shape the engine
 * would produce from a re-scan, so pass 2 finds nothing to do.
 *
 * Convergence: if the cap is reached with converging findings still
 * pending, throws `ApplyFixesConvergenceError` carrying per-file
 * stats (`{ file, ruleId, passCount, lastAppliedCount }`).
 */
export async function applyFixes(
  findings: readonly Finding[],
  rulesById: ReadonlyMap<string, RuleSpec>,
  options: ApplyFixesOptions,
): Promise<ApplyFixesResult> {
  const rawMaxPasses = options.maxPasses ?? APPLY_FIXES_DEFAULT_MAX_PASSES;
  const maxPasses = Math.min(
    Math.max(1, Number.isFinite(rawMaxPasses) ? Math.floor(rawMaxPasses) : 1),
    APPLY_FIXES_MAX_PASSES_CAP,
  );

  // 1. Compute the converging-rule set from the INITIAL findings.
  //    Only rules that opted in (and produced at least one violation)
  //    participate in the fixpoint — non-converging rules are
  //    single-pass and their matches, if any survive pass 1, are left
  //    as-is (the engine doesn't re-emit them on later passes).
  const convergingRuleIds = collectConvergingRuleIds(findings, rulesById);
  const convergingRules = convergingRuleIds.size === 0
    ? []
    : compileConvergingRules(rulesById, convergingRuleIds);

  // 2. Accumulate across all passes.
  const allApplied: AppliedEdit[] = [];
  const allDeferred: DeferredEdit[] = [];
  const allSuggested: SuggestedEdit[] = [];
  const changedFiles: string[] = [];
  const diffPieces: string[] = [];

  let passCount = 0;
  let pendingFindings: readonly Finding[] = findings;
  const contentOverrides = new Map<string, string>();
  let lastAppliedCount = 0;
  let lastHotFile: string | null = null;
  let lastHotRule: string | null = null;

  while (true) {
    // Hit the budget with work still pending → throw.
    if (passCount >= maxPasses) {
      if (lastAppliedCount > 0 || pendingFindings.length > 0) {
        const hotFile = lastHotFile ?? pendingFindings[0]?.path ?? '<unknown>';
        const hotRule = lastHotRule ?? pendingFindings[0]?.ruleId ?? '<unknown>';
        throw new ApplyFixesConvergenceError(
          `applyFixes did not converge within ${maxPasses} passes. ` +
          `Last hot file: ${hotFile}, last hot rule: ${hotRule}, ` +
          `applied in last pass: ${lastAppliedCount}, pending findings: ${pendingFindings.length}`,
          {
            file: hotFile,
            ruleId: hotRule,
            passCount,
            lastAppliedCount,
          },
        );
      }
      break;
    }

    // Filter findings: pass 1 = all violations; pass > 1 = only
    // converging rules. Non-converging rules don't re-fire even if
    // their template re-introduces a match — the user opted them
    // out by leaving `converges` unset.
    const findingsForPass = passCount === 0
      ? pendingFindings.filter((f) => f.status === 'violation')
      : pendingFindings.filter((f) => convergingRuleIds.has(f.ruleId));

    if (findingsForPass.length === 0) {
      // Nothing to do — the loop terminates without incrementing
      // `passCount`, so `passes` in the result reflects the work
      // actually performed (0 for a no-op call, 1 for a single-pass
      // fix, N for a fixpoint that fired N times).
      break;
    }
    passCount++;

    const passResult = await applyOnePass(
      findingsForPass,
      rulesById,
      options,
      contentOverrides,
    );

    lastAppliedCount = passResult.applied.length;
    if (passResult.changedFiles.length > 0) {
      lastHotFile = passResult.changedFiles[0] ?? null;
    }
    if (passResult.applied.length > 0) {
      const first = passResult.applied[0]!;
      lastHotRule = first.ruleId;
    }

    // Accumulate.
    for (const e of passResult.applied) allApplied.push(e);
    for (const d of passResult.deferred) allDeferred.push(d);
    for (const s of passResult.suggested) allSuggested.push(s);
    for (const f of passResult.changedFiles) {
      if (!changedFiles.includes(f)) {
        changedFiles.push(f);
      }
    }
    for (const line of passResult.unifiedDiff.split('\n')) {
      if (line.length > 0) {
        diffPieces.push(line);
      }
    }

    // Update in-memory content overrides for the next pass.
    for (const [file, content] of passResult.updatedContent) {
      contentOverrides.set(file, content);
    }

    // No progress → stop. The fixpoint terminates as soon as a pass
    // produces zero applied edits OR no converging findings remain
    // — either way, another iteration would do nothing useful.
    if (passResult.applied.length === 0) {
      break;
    }

    // If no rules opted into the fixpoint, there's nothing to re-scan
    // — bail out before paying for the detection primitive.
    if (convergingRules.length === 0) {
      break;
    }

    // 3. Re-scan each changed file with the converging rule set.
    //    AST findings produced here would have no fix attachment
    //    (the fixer engine only handles regex-kind `RuleFixSpec`),
    //    so they'd be deferred as `no-fix-attached` on the next
    //    pass — safe to emit them.
    const nextFindings: Finding[] = [];
    for (const file of passResult.changedFiles) {
      const content = contentOverrides.get(file);
      if (content === undefined) {
        continue;
      }
      const fileFindings = await detectFile(file, convergingRules, {
        content,
        ...(options.acceptList !== undefined ? { acceptList: options.acceptList } : {}),
        ...(options.contextBuffer !== undefined ? { contextBuffer: options.contextBuffer } : {}),
      });
      for (const f of fileFindings) {
        // Only re-emit findings whose rule opted in — that's the
        // fixpoint's whole point. AST findings and accept-list
        // matches are filtered out here even if `detectFile`
        // produced them.
        if (convergingRuleIds.has(f.ruleId)) {
          nextFindings.push(f);
        }
      }
    }

    if (nextFindings.length === 0) {
      break;
    }
    pendingFindings = nextFindings;
  }

  return {
    applied: allApplied,
    changedFiles,
    deferred: allDeferred,
    suggested: allSuggested,
    unifiedDiff: diffPieces.join('\n'),
    passes: passCount,
  };
}

/**
 * Try to run a `function`-kind fix on a single finding. Returns the
 * edits it produced, or `null` if it declined. Wraps the function
 * call in a try/catch — a buggy function-fix must not bring down
 * the entire run.
 */
function tryRunFunction(
  fix: RuleFixFunction,
  ruleId: string,
  filePath: string,
  content: string,
): readonly RuleFixEdit[] | null {
  try {
    const ctx: RuleFixContext = { filePath, content };
    return fix.apply(ctx);
  } catch {
    process.stderr.write(`warning: function fix ${ruleId} threw; edits dropped\n`);
    return null;
  }
}
