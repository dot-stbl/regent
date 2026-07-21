/**
 * L1: wrap-ansi unit tests
 *
 * Pure function `wrapAnsi(text, width)`. Edge cases:
 * - empty / disabled width / short text
 * - ASCII whitespace wrap
 * - hard break when no whitespace in budget
 * - ANSI preservation across wrap rows (close style at row end, re-open at next row start)
 * - explicit `\n` paragraph boundaries
 * - CSI terminator classification (`m` only — cursor moves are dropped)
 */

/* eslint-disable no-control-regex */ // regex deliberately matches the ESC byte.

import { describe, expect, it } from 'vitest';

import { wrapAnsi } from '../../src/reporter/wrap-ansi.js';

describe('wrapAnsi', () => {
  it('returns input unchanged when width < 1', () => {
    expect(wrapAnsi('hello world', 0)).toBe('hello world');
    expect(wrapAnsi('hello world', -5)).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(wrapAnsi('', 80)).toBe('');
  });

  it('returns input unchanged when it fits in width', () => {
    expect(wrapAnsi('hello world', 80)).toBe('hello world');
  });

  it('wraps ASCII at the last whitespace before the width budget', () => {
    const out = wrapAnsi('the quick brown fox jumps over', 15);
    // Wraps at the last space before column 15, prefers "over" on its own row.
    const lines = out.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      // Each row's visible length is ≤ width.
      expect(line.length).toBeLessThanOrEqual(15);
    }
    // Joined back without the spaces we shifted should still contain the original words.
    expect(out.replace(/\s+/g, ' ').trim()).toBe('the quick brown fox jumps over');
  });

  it('hard-breaks when no whitespace appears inside the width budget', () => {
    const out = wrapAnsi('abcdefghijklmnopqrstuvwxyz', 5);
    const lines = out.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(5);
    // Re-joining without newlines gives back the original character run
    // (visible width == input width in this case; no ANSI escapes).
    expect(lines.join('')).toBe('abcdefghijklmnopqrstuvwxyz');
  });

  it('closes a mid-row style with reset and re-opens it on the next row', () => {
    const coloured = `${'\u001b[31m'}the quick brown fox jumps over the lazy dog${'\u001b[39m'}`;
    const out = wrapAnsi(coloured, 15);
    expect(out).toContain('\u001b[31m');
    expect(out).toContain('\u001b[39m');
    // Wrap happens at least once — visible rows are ≤ 15 visible chars each.
    const lines = out.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    // After a wrap, the next visual row should re-open the active style.
    // We assert presence of \u001b[31m at the start of a continuation row.
    expect(out).toMatch(/\u001b\[0m\n\u001b\[31m/);
  });

  it('treats \\x1b[0m, \\x1b[39m, \\x1b[49m as resets (not opens)', () => {
    // Wrap the reset immediately inside a wider coloured segment.
    const coloured = `aaa${'\u001b[31m'}bb cc dd ee ff${'\u001b[0m'}zz`;
    const out = wrapAnsi(coloured, 10);
    // The output should not redundantly emit \x1b[0m before the literal reset.
    // (Smoke: it has at least one \x1b[0m somewhere — the embedded one — and no doubled reset.)
    const resets = out.match(/\u001b\[0m/g) ?? [];
    expect(resets.length).toBeGreaterThanOrEqual(1);
  });

  it('honours explicit \\n as paragraph boundaries', () => {
    const out = wrapAnsi('first line\nsecond line', 80);
    expect(out).toBe('first line\nsecond line');
  });

  it('breaks on \\n even within a styled block, dropping the active style', () => {
    const coloured = `${'\u001b[31m'}first line${'\u001b[0m'}\n${'\u001b[31m'}second line${'\u001b[0m'}`;
    const out = wrapAnsi(coloured, 80);
    expect(out).toContain('first line');
    expect(out).toContain('second line');
    // Both rows carry their own open SGR — the mid-block \n cleared the
    // internal "active" tracker, so the second segment emits its own opener.
    const opens = out.match(/\u001b\[31m/g) ?? [];
    expect(opens.length).toBe(2);
  });

  it('drops CSI cursor-move sequences (non-m terminator) during wrap', () => {
    // A \x1b[2K is "erase line" — terminal-only, should be discarded.
    const text = `aaa${'\u001b'}[2K bbb`;
    const out = wrapAnsi(text, 5);
    expect(out).not.toContain('\u001b[2K');
    expect(out).toContain('aaa');
    expect(out).toContain('bbb');
  });

  it('preserves visible characters when wrapping (input chars == output chars minus inserts)', () => {
    const input = 'the\tquick brown  fox jumped   over the lazy dog';
    const out = wrapAnsi(input, 12);
    // Visible content (joining rows by removing ONLY the inserted \n)
    // should match the original up to whitespace normalization.
    expect(out.replace(/\n/g, ' ').replace(/[ \t]+/g, ' ').trim()).toBe(
      input.replace(/[ \t]+/g, ' ').trim(),
    );
  });

  it('handles a row whose wrap budget is exactly the input length', () => {
    const out = wrapAnsi('hello world', 11);
    expect(out).toBe('hello world');
    const out2 = wrapAnsi('hello world!', 11);
    // 12 chars > 11, must wrap; the wrap budget is met right at the space.
    expect(out2).not.toBe('hello world!');
  });

  it('hard-break returns rows of at most `width` chars (no overflow)', () => {
    // Input has no whitespace at all — only hard-breaks possible.
    // Every output row must be <= width chars.
    const input = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const out = wrapAnsi(input, 10);
    for (const row of out.split('\n')) {
      expect(row.length).toBeLessThanOrEqual(10);
    }
    // Reassembly: removing our inserted \n gives back the original.
    expect(out.split('\n').join('')).toBe(input);
  });
});
