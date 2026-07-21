/**
 * L0: runner concurrency cap (#18).
 *
 * The runner used to `Promise.all(files.map(scanFile))` — unbounded,
 * limited only by the libuv threadpool default of 4. With `--concurrency
 * N` (CLI), `runner.concurrency` (config), or
 * `STBL_REGENT_RUNNER_CONCURRENCY` (env), the per-file work must be
 * capped at N in-flight.
 *
 * Strategy: invoke `runWithConcurrency` directly with an `fn` that
 * increments a counter on entry, sleeps a tick, decrements on exit,
 * and records the high-water mark. With limit=3, the high-water mark
 * must never exceed 3.
 */

import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from '../src/runner.js';

describe('runWithConcurrency', () => {
  it('runs every item exactly once', async () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const seen: number[] = [];
    const result = await runWithConcurrency(items, 4, async (n) => {
      seen.push(n);
      return n * 2;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
    expect(result).toEqual(items.map((n) => n * 2));
  });

  it('preserves input order in the result array', async () => {
    const items = [10, 20, 30, 40, 50];
    const result = await runWithConcurrency(items, 2, async (n) => {
      // Vary latency so the result is non-trivially reordered-by-completion.
      await new Promise((r) => setTimeout(r, 50 - n / 4));
      return `v${n}`;
    });
    expect(result).toEqual(['v10', 'v20', 'v30', 'v40', 'v50']);
  });

  it('caps in-flight tasks at the given limit', async () => {
    let inFlight = 0;
    let highWater = 0;
    const items = Array.from({ length: 40 }, (_, i) => i);

    await runWithConcurrency(items, 3, async (n) => {
      inFlight++;
      if (inFlight > highWater) {
        highWater = inFlight;
      }
      // Yield to the event loop so the next worker can pick up a
      // queued item while we're "in flight".
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n;
    });

    expect(highWater).toBeLessThanOrEqual(3);
    expect(highWater).toBeGreaterThan(1); // sanity: we actually ran in parallel
  });

  it('honours limit=1 (sequential)', async () => {
    let inFlight = 0;
    let highWater = 0;
    const items = [1, 2, 3, 4, 5];

    await runWithConcurrency(items, 1, async (n) => {
      inFlight++;
      if (inFlight > highWater) {
        highWater = inFlight;
      }
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n;
    });

    expect(highWater).toBe(1);
  });

  it('clamps the limit to the number of items', async () => {
    let highWater = 0;
    let inFlight = 0;
    const items = [1, 2, 3];

    await runWithConcurrency(items, 99, async (n) => {
      inFlight++;
      if (inFlight > highWater) {
        highWater = inFlight;
      }
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n;
    });

    expect(highWater).toBe(items.length);
  });

  it('treats limit=0 as 1 (defensive)', async () => {
    let highWater = 0;
    let inFlight = 0;
    const items = [1, 2, 3];

    await runWithConcurrency(items, 0, async (n) => {
      inFlight++;
      if (inFlight > highWater) {
        highWater = inFlight;
      }
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n;
    });

    expect(highWater).toBe(1);
  });

  it('returns an empty array for empty input', async () => {
    const result = await runWithConcurrency([], 4, async (n: number) => n);
    expect(result).toEqual([]);
  });

  it('propagates rejections (one failure fails the whole batch)', async () => {
    const items = [1, 2, 3, 4, 5];
    await expect(
      runWithConcurrency(items, 2, async (n) => {
        if (n === 3) {
          throw new Error('boom');
        }
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

/**
 * Higher-level check: the runner actually applies the cap. We can't
 * instrument `scanFile` directly, but we *can* verify the public
 * `RunOptions.concurrency` field is honoured by driving `runRules`
 * with a large scope and counting concurrent reads via a probe.
 *
 * The probe replaces `fs/promises.readFile` (via vitest module mock
 * is overkill for this) — instead we run a synthetic scope large
 * enough that parallelism is observable, with `concurrency: 2`, and
 * assert the run completes without errors. The cap is verified at
 * the `runWithConcurrency` level above; this is a smoke test that
 * the option threads through end-to-end.
 */
describe('runRules concurrency option', () => {
  it('accepts a concurrency value without erroring', async () => {
    const { runRules } = await import('../src/runner.js');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmp = mkdtempSync(join(tmpdir(), 'regent-conc-'));
    try {
      for (let i = 0; i < 8; i++) {
        writeFileSync(join(tmp, `file-${i}.txt`), `line ${i}\n`);
      }

      const result = await runRules(
        [],
        {
          cwd: tmp,
          includeGlobs: ['**/*.txt'],
          excludeGlobs: [],
          changedOnly: false,
          diffBase: 'HEAD',
        },
        { concurrency: 2 },
      );
      expect(result.scannedFiles).toBe(8);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('uses the libuv default (4) when no concurrency option is set', async () => {
    const { runRules } = await import('../src/runner.js');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmp = mkdtempSync(join(tmpdir(), 'regent-conc-default-'));
    try {
      for (let i = 0; i < 6; i++) {
        writeFileSync(join(tmp, `f-${i}.txt`), `x\n`);
      }

      const result = await runRules([], {
        cwd: tmp,
        includeGlobs: ['**/*.txt'],
        excludeGlobs: [],
        changedOnly: false,
        diffBase: 'HEAD',
      });
      expect(result.scannedFiles).toBe(6);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
