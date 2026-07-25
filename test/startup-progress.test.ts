/**
 * Unit tests for the startup-progress helper.
 *
 * The helper's job is to emit a single dim line on stderr when a
 * `loadRules` call exceeds `SLOW_LOAD_THRESHOLD_MS` (500ms by default).
 * Sub-second loads stay silent; `--quiet` always silences.
 *
 * To keep these tests fast we use the `thresholdMs` override to make
 * the "slow" path trigger without a real 500ms wait. The default 500ms
 * value is asserted directly against the exported constant — the
 * override path proves the comparison logic works, the constant
 * asserts the production threshold.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadRulesWithProgress,
  SLOW_LOAD_THRESHOLD_MS,
  type RuleSetLike,
} from '../src/cli/startup-progress.js';

function fakeRuleSet(rules: number, ast: number, transform: number): RuleSetLike {
  return {
    rules: new Array(rules).fill({}),
    astRules: new Array(ast).fill({}),
    transformRules: new Array(transform).fill({}),
  };
}

describe('loadRulesWithProgress', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('exposes the production threshold at 500ms', () => {
    // Pin the contract: changes to this constant are a deliberate
    // UX decision (printed timing line at the rule-load tail), not a
    // silent tightening.
    expect(SLOW_LOAD_THRESHOLD_MS).toBe(500);
  });

  it('stays silent when the load is fast', async () => {
    await loadRulesWithProgress(
      async () => fakeRuleSet(3, 0, 0),
      { quiet: false, thresholdMs: 1000 },
    );
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('emits one line on stderr when the load is slow', async () => {
    const result = await loadRulesWithProgress(
      async () => fakeRuleSet(5, 2, 1),
      { quiet: false, thresholdMs: 0 },
    );

    // Loader result must be returned unchanged — the helper is a
    // pass-through, not a transformer.
    expect(result.rules).toHaveLength(5);
    expect(result.astRules).toHaveLength(2);
    expect(result.transformRules).toHaveLength(1);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const line = String(writeSpy.mock.calls[0]?.[0] ?? '');
    // Strip ANSI escape codes so the assertion is colour-agnostic.
    // picocolors wraps the line in dim codes when colour is on.
    // eslint-disable-next-line no-control-regex -- matching ANSI CSI sequences
    const plain = line.replace(/\u001b\[\d+m/g, '');
    expect(plain).toBe('regent: loaded 8 rules in 0.00s\n');
  });

  it('skips when quiet=true regardless of load time', async () => {
    await loadRulesWithProgress(
      async () => fakeRuleSet(5, 0, 0),
      { quiet: true, thresholdMs: 0 },
    );
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
