/**
 * L0: line-based diff — LCS table + unified-diff renderer.
 */

import { describe, expect, it } from 'vitest';

import { diffLines, renderUnifiedDiff } from '../src/core/diff.js';

describe('diffLines', () => {
  it('returns an empty diff for identical inputs', () => {
    const r = diffLines('a\nb\nc', 'a\nb\nc');
    expect(r.hunks).toEqual([]);
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(0);
  });

  it('returns an empty diff for empty inputs', () => {
    const r = diffLines('', '');
    expect(r.hunks).toEqual([]);
  });

  it('detects a single-line addition', () => {
    const r = diffLines('a\nb', 'a\nb\nc');
    expect(r.additions).toBe(1);
    expect(r.deletions).toBe(0);
    expect(r.hunks.length).toBe(1);
  });

  it('detects a single-line deletion', () => {
    const r = diffLines('a\nb\nc', 'a\nc');
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(1);
    expect(r.hunks.length).toBe(1);
  });

  it('detects a substitution (delete + add)', () => {
    const r = diffLines('hello\n', 'world\n');
    expect(r.additions).toBe(1);
    expect(r.deletions).toBe(1);
  });

  it('handles multi-hunk diffs (changes separated by context)', () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
    const newText = oldText
      .replace('line5', 'CHANGED5')
      .replace('line15', 'CHANGED15');
    const r = diffLines(oldText, newText);
    expect(r.hunks.length).toBeGreaterThanOrEqual(1);
    expect(r.additions).toBe(2);
    expect(r.deletions).toBe(2);
  });

  it('preserves context lines around changes', () => {
    const oldText = 'a\nb\nc\nd\ne';
    const newText = 'a\nb\nC\nd\ne';
    const r = diffLines(oldText, newText);
    // hunk should include surrounding context (3 lines each side).
    const first = r.hunks[0]!;
    const contextLines = first.lines.filter((l) => l.startsWith(' ')).length;
    expect(contextLines).toBeGreaterThanOrEqual(2);
  });
});

describe('renderUnifiedDiff', () => {
  it('renders an empty diff as empty string', () => {
    const r = diffLines('a', 'a');
    expect(renderUnifiedDiff(r, 'foo.txt')).toBe('');
  });

  it('emits the unified-diff header lines', () => {
    const r = diffLines('a', 'b');
    const text = renderUnifiedDiff(r, 'foo.txt');
    expect(text).toMatch(/^--- a\/foo\.txt$/m);
    expect(text).toMatch(/^\+\+\+ b\/foo\.txt$/m);
  });

  it('emits @@ hunk headers', () => {
    const r = diffLines('a\nb', 'a\nB');
    const text = renderUnifiedDiff(r, 'foo.txt');
    expect(text).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
  });
});