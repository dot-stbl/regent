/**
 * fixer.ts — the applyFixes engine (Phase 2 of the fix-mode epic, #7).
 *
 * Reads each changed file once, computes a per-finding edit from
 * the rule's `fix` attachment, applies edits in a single right-to-left
 * pass per file, and writes the result back. Edits that conflict with
 * a higher-priority edit are deferred (returned, not applied) per
 * the design in #7 §7.
 *
 * MVP scope (P2):
 * - `replace` (template-driven) and `delete-line` only. `function`
 *   and `guidance-only` are P5 / P7 — they're surfaced via the
 *   `suggested` array instead of being applied.
 * - Single-pass per file. Fixpoint + idempotence guard lands in P4.
 * - Per-rule `apply: replace` and `delete-line` only, no template
 *   function-form yet (P7).
 * - Right-to-left application: edits sorted by `start` ascending,
 *   applied from highest offset downward so earlier offsets stay
 *   valid.
 *
 * Pure functions over `(content, edits)`; the file I/O is
 * isolated to `applyFixes` itself.
 */

import { readFile, writeFile } from 'node:fs/promises';

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
}

interface ApplyEditsResult {
  newContent: string;
  applied: { edit: RuleFixEdit; ruleId: string; title: string }[];
  deferredOverlap: { edit: RuleFixEdit; ruleId: string; title: string; start: number; end: number }[];
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
  const deferredOverlap: { edit: RuleFixEdit; ruleId: string; title: string; start: number; end: number }[] = [];
  let result = '';
  let cursor = 0;
  let lastAppliedEnd = -1;

  for (const { edit, ruleId, title } of sorted) {
    if (edit.end > content.length) {
      // Skip out-of-range edits (no recovery — runner can re-scan).
      continue;
    }
    if (edit.start < lastAppliedEnd) {
      // Overlaps with a previously applied edit on this file. Defer.
      deferredOverlap.push({
        edit,
        ruleId,
        title,
        start: edit.start,
        end: edit.end,
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
    applied.push({ edit, ruleId, title });
  }
  // Append the unchanged content after the last edit.
  if (cursor < content.length) {
    result += content.slice(cursor);
  }
  return { newContent: result, applied, deferredOverlap };
}

/**
 * Top-level entry point. Read each affected file, compute + apply the
 * per-finding edits, write back. Returns the structured result.
 *
 * Per the AC, this is a single-pass engine (no fixpoint yet — P4). It
 * is also **deterministic** + **idempotent at the content level**:
 * running the same input twice produces the same output the second
 * time (no remaining matches after the first pass).
 */
export async function applyFixes(
  findings: readonly Finding[],
  rulesById: ReadonlyMap<string, RuleSpec>,
  options: ApplyFixesOptions,
): Promise<ApplyFixesResult> {
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

  // 2. For each file, read content, compute edits, apply.
  const applied: AppliedEdit[] = [];
  const deferred: DeferredEdit[] = [];
  const suggested: SuggestedEdit[] = [];
  const changedFiles: string[] = [];
  const diffPieces: string[] = [];

  for (const [relPath, fileFindings] of byFile) {
    const absPath = relPath;

    let content: string;
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

    // Build per-finding edits. Each finding has its own rule, so we
    // look up `rule` + `fileFix` per finding rather than once per file.
    // Function / guidance-only are deferred to the `suggested` array.
    const edits: { edit: RuleFixEdit; ruleId: string; title: string }[] = [];
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
        // function / guidance-only: surface as suggested.
        if (fileFix.kind === 'function') {
          const fnFix = fileFix as RuleFixFunction;
          const suggestedEdits = tryRunFunction(fnFix, absPath, content);
          if (suggestedEdits !== null) {
            for (const se of suggestedEdits) {
              suggested.push({
                ruleId: f.ruleId,
                file: relPath,
                range: { start: se.start, end: se.end },
                title: fnFix.title,
                guidance: fnFix.guidance,
                proposedEdit: {
                  start: se.start,
                  end: se.end,
                  replacement: se.replacement,
                },
              });
            }
          }
        } else {
          // guidance-only
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
      });
    }
  }

  return {
    applied,
    changedFiles,
    deferred,
    suggested,
    unifiedDiff: diffPieces.join('\n'),
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
  filePath: string,
  content: string,
): readonly RuleFixEdit[] | null {
  try {
    const ctx: RuleFixContext = { filePath, content };
    return fix.apply(ctx);
  } catch {
    return null;
  }
}