/**
 * L0: pure-unit test — regex.ts (RE2 wrapper) compile + test.
 */

import { describe, expect, it } from 'vitest';

import { compileRegex } from '../src/regex.js';

describe('compileRegex', () => {
  it('matches a literal pattern', async () => {
    const r = await compileRegex('#region');
    expect(r.test('#region Properties')).toBe(true);
    expect(r.test('#endregion')).toBe(false);
  });

  it('respects multiline flag for whitespace + line anchors', async () => {
    const r = await compileRegex('^\\s*#region\\s', { multiline: true });
    expect(r.test('#region Properties')).toBe(true);
    expect(r.test('    #region Properties')).toBe(true);
  });

  it('returns the source string verbatim', async () => {
    const r = await compileRegex('#region\\b');
    expect(r.source).toBe('#region\\b');
  });

  it('throws on malformed RE2 pattern', () => {
    expect(() => compileRegex('(?<bad)')).toThrow();
  });
});

describe('firstMatch', () => {
  it('returns precise offsets + matched text', async () => {
    const r = await compileRegex('#region');
    const hit = r.firstMatch('    #region Props');
    expect(hit).not.toBeNull();
    expect(hit!.start).toBe(4);
    expect(hit!.end).toBe(11); // '#region' is 7 chars: [4, 11)
    expect(hit!.text).toBe('#region');
    expect(hit!.groups).toEqual([]);
  });

  it('captures group values', async () => {
    const r = await compileRegex('(_[A-Za-z]\\w*)\\s*=\\s*(\\d+)');
    const hit = r.firstMatch('    private int _count = 42;');
    expect(hit).not.toBeNull();
    expect(hit!.text).toBe('_count = 42');
    expect(hit!.start).toBe(16);
    expect(hit!.groups).toEqual(['_count', '42']);
  });

  it('returns null when there is no match', async () => {
    const r = await compileRegex('#region');
    expect(r.firstMatch('nothing here')).toBeNull();
  });

  it('is repeatable and safe to interleave with test()', async () => {
    const r = await compileRegex('a');
    expect(r.test('xax')).toBe(true);
    expect(r.firstMatch('xax')!.start).toBe(1);
    expect(r.firstMatch('xax')!.start).toBe(1); // no lastIndex drift
    expect(r.test('xax')).toBe(true);
  });
});
