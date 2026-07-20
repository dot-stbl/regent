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
