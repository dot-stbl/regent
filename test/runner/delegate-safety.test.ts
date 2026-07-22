/**
 * L0: argv safety — the differentiator for reg-as-orchestrator
 * (issue #34b). The token blocklist + first-token denylist must
 * reject every canonical long-lived pattern (`vite`, `next`,
 * `webpack-dev-server`, `--watch`, `--port`, …) so a spec
 * author's `detect: (p) => ['vite', …]` can never escape into a
 * dev server, and the CLI exits with a clear failure finding.
 */

import { describe, expect, it } from 'vitest';

import {
  BLOCKED_TOKENS,
  FIRST_TOKEN_DENYLIST,
  isSafeArgv,
  SafetyError,
} from '../../src/runner/delegate.js';

describe('isSafeArgv', () => {
  describe('BLOCKED_TOKENS — literal-token match anywhere in argv', () => {
    for (const token of BLOCKED_TOKENS) {
      it(`rejects argv containing '${token}' as a separate element`, () => {
        const result = isSafeArgv(['eslint', token, '--check']);
        expect(result.safe).toBe(false);
        expect(result.reason).toMatch(new RegExp(token));
      });
    }
  });

  describe('FIRST_TOKEN_DENYLIST — first argv element', () => {
    for (const command of FIRST_TOKEN_DENYLIST) {
      it(`rejects argv[0] === '${command}'`, () => {
        const result = isSafeArgv([command]);
        expect(result.safe).toBe(false);
        expect(result.reason).toMatch(/argv\[0\]/);
      });
    }
  });

  it('accepts a clean argv (prettier --check)', () => {
    expect(isSafeArgv(['prettier', '--check', '.'])).toEqual({
      safe: true,
      reason: undefined,
    });
  });

  it('accepts an empty argv (caller-side responsibility to skip the spec)', () => {
    // isSafeArgv itself does not police emptiness; the caller
    // (runSpecDetect) raises via safeSpawn instead. The safety
    // check still considers an empty array safe-by-default so the
    // caller can decide how to surface the gap.
    expect(isSafeArgv([])).toEqual({ safe: true, reason: undefined });
  });

  it('matches whole argv elements only (token = exact element)', () => {
    // The blocklist compares whole argv elements, not substrings.
    // `--port=3000` (single element) is NOT blocked because the
    // exact-token match fails — this is a known limitation. Spec
    // authors that need port-binding-style flags MUST split the
    // argument into two argv elements (`['--port', '3000']`) so the
    // runner catches the flag form.
    expect(isSafeArgv(['dotnet', '--port=3000'])).toEqual({
      safe: true,
      reason: undefined,
    });
    expect(isSafeArgv(['dotnet', '--my-port=3000'])).toEqual({
      safe: true,
      reason: undefined,
    });
    // The dangerous form (flag + value as separate elements) IS
    // blocked — `--port` matches BLOCKED_TOKENS exactly.
    expect(isSafeArgv(['dotnet', '--port', '3000'])).toEqual({
      safe: false,
      reason: expect.stringContaining('--port'),
    });
  });
});

describe('SafetyError', () => {
  it('captures argv + reason and produces a useful message', () => {
    const argv = ['vite', '--port=3000'] as const;
    const err = new SafetyError(argv, 'refused');
    expect(err.argv).toEqual(argv);
    expect(err.reason).toBe('refused');
    expect(err.message).toContain('unsafe argv');
    expect(err.name).toBe('SafetyError');
    expect(err).toBeInstanceOf(Error);
  });
});
