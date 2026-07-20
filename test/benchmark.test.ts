/**
 * L0: benchmark module — generates synthetic workload, runs scan,
 * records median duration. Baseline is written on first run;
 * subsequent runs report delta-vs-baseline.
 */

import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runBenchmark } from '../src/core/benchmark.js';

describe('runBenchmark', () => {
  let tmp: string;
  let tmpCwd: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'regent-bench-'));
    tmpCwd = process.cwd();
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(tmpCwd);
  });

  it('runs the synthetic workload and returns a result', async () => {
    const result = await runBenchmark({ files: 20, rules: 5, iterations: 2 });
    expect(result.files).toBe(20);
    expect(result.rules).toBe(5);
    expect(result.iterations).toBe(2);
    expect(result.durationsMs).toHaveLength(2);
    expect(result.medianMs).toBeGreaterThan(0);
    expect(result.meanMs).toBeGreaterThan(0);
    expect(result.minMs).toBeGreaterThan(0);
    expect(result.maxMs).toBeGreaterThan(0);
    expect(result.medianMs).toBeGreaterThanOrEqual(result.minMs);
    expect(result.medianMs).toBeLessThanOrEqual(result.maxMs);
  });

  it('writes a baseline file on first run', async () => {
    const result = await runBenchmark({ files: 5, rules: 2, iterations: 1 });
    expect(result.medianMs).toBeGreaterThan(0);
    expect(existsSync(join(tmp, '.regent/baseline.json'))).toBe(true);
  });

  it('reports a baseline delta on subsequent runs', async () => {
    // First run — creates baseline.
    await runBenchmark({ files: 5, rules: 2, iterations: 1 });
    // Second run — should report baselineDeltaPct.
    const result = await runBenchmark({ files: 5, rules: 2, iterations: 1 });
    expect(result.baselineDeltaPct).not.toBeNull();
  });
});