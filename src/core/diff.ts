// Tiny line-based diff — emits unified-diff hunks for `regent fix --diff`.
//
// We deliberately avoid pulling in a `diff` library: a Myers diff
// for the typical fix output (a few hundred lines, one or two hunks)
// is a few hundred lines of code. The implementation below is the
// standard LCS-table + backtrack approach; O(N*M) memory but fine for
// the sizes we expect (single fix output rarely > 10k lines).

export interface DiffHunk {
  readonly oldStart: number;     // 1-indexed
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];   // ' ' context, '-' removed, '+' added
}

export interface DiffResult {
  readonly hunks: readonly DiffHunk[];
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Compute a unified diff between two strings, line by line.
 * Empty diff returns an empty result. Identical inputs return an
 * empty result.
 */
export function diffLines(oldText: string, newText: string): DiffResult {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const lcs = buildLcsTable(a, b);

  const ops: Array<{ kind: ' ' | '-' | '+'; line: string }> = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ kind: ' ', line: a[i - 1]! });
      i--;
      j--;
    } else if (lcs[i - 1]![j]! >= lcs[i]![j - 1]!) {
      ops.push({ kind: '-', line: a[i - 1]! });
      i--;
    } else {
      ops.push({ kind: '+', line: b[j - 1]! });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ kind: '-', line: a[i - 1]! });
    i--;
  }
  while (j > 0) {
    ops.push({ kind: '+', line: b[j - 1]! });
    j--;
  }
  ops.reverse();

  // Group into hunks of contiguous non-context changes.
  const CONTEXT = 3;
  const hunks: DiffHunk[] = [];
  let cursor = 0;
  while (cursor < ops.length) {
    // Skip a run of context until we hit a change.
    while (cursor < ops.length && ops[cursor]!.kind === ' ') {
      cursor++;
    }
    if (cursor >= ops.length) {
      break;
    }
    // Find the end of the change run.
    let changeEnd = cursor;
    while (changeEnd < ops.length && ops[changeEnd]!.kind !== ' ') {
      changeEnd++;
    }
    // Back up to include trailing context (up to CONTEXT lines).
    let hunkEnd = changeEnd;
    let trailing = 0;
    while (hunkEnd < ops.length && ops[hunkEnd]!.kind === ' ' && trailing < CONTEXT) {
      hunkEnd++;
      trailing++;
    }
    // Forward to include leading context (up to CONTEXT lines) for
    // the next hunk header.
    let hunkStart = cursor;
    let leading = 0;
    while (hunkStart > 0 && ops[hunkStart - 1]!.kind === ' ' && leading < CONTEXT) {
      hunkStart--;
      leading++;
    }
    // Build the hunk lines.
    const slice = ops.slice(hunkStart, hunkEnd);
    let oldStart = 0;
    let newStart = 0;
    for (let k = 0; k < slice.length; k++) {
      if (slice[k]!.kind === ' ') {
        if (oldStart === 0) {
          oldStart = k;
          newStart = k;
        }
      }
    }
    // Recompute hunk header line numbers properly.
    oldStart = 1;
    newStart = 1;
    let oldLines = 0;
    let newLines = 0;
    for (let k = 0; k < hunkStart; k++) {
      const op = ops[k]!;
      if (op.kind === ' ') {
        oldStart++;
        newStart++;
      } else if (op.kind === '-') {
        oldStart++;
      } else if (op.kind === '+') {
        newStart++;
      }
    }
    for (const op of slice) {
      if (op.kind === ' ' || op.kind === '-') {
        oldLines++;
      }
      if (op.kind === ' ' || op.kind === '+') {
        newLines++;
      }
    }
    hunks.push({
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines: slice.map((op) => `${op.kind}${op.line}`),
    });
    cursor = hunkEnd;
  }

  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line.startsWith('+')) {
        additions++;
      } else if (line.startsWith('-')) {
        deletions++;
      }
    }
  }
  return { hunks, additions, deletions };
}

function buildLcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j] ?? 0, dp[i]![j - 1] ?? 0);
      }
    }
  }
  return dp;
}

/**
 * Render a `DiffResult` as a unified-diff string (the same format
 * `git diff` produces). Empty diff returns an empty string.
 */
export function renderUnifiedDiff(result: DiffResult, label: string): string {
  if (result.hunks.length === 0) {
    return '';
  }
  const out: string[] = [`--- a/${label}`, `+++ b/${label}`];
  for (const h of result.hunks) {
    out.push(
      `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    );
    for (const line of h.lines) {
      out.push(line);
    }
  }
  return out.join('\n') + '\n';
}