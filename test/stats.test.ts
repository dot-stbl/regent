/**
 * L0: `regent stats` (#13) — by-severity / by-rule / by-file summaries
 * + a 5-run trend that reads from `.regent/cache.json`.
 *
 * Covers: pure helpers (`computeStats`, `topCounts`, `renderStatsText`,
 * `renderStatsJson`), the on-disk history round-trip
 * (`loadStatsHistory` / `saveStatsHistory`), the text and JSON output
 * shapes, and the "insufficient history" branch when fewer than 5
 * snapshots are present. The CLI plumbing is covered by
 * `test/cli.test.ts` smoke tests.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  STATS_HISTORY_MAX,
  computeStats,
  loadStatsHistory,
  renderStatsJson,
  renderStatsText,
  saveStatsHistory,
  topCounts,
  type StatsHistoryEntry,
  type StatsSummary,
} from '../src/cli/stats.js';
import type { Finding, Severity } from '../src/types.js';

let tmpRoot = '';

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'regent-stats-'));
});

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

const CWD = '/repo/proj';

function makeFinding(
  ruleId: string,
  severity: Severity,
  path: string,
  line: number,
  status: Finding['status'] = 'violation',
): Finding {
  return {
    ruleId,
    severity,
    path,
    match: { startLine: line, startColumn: 0, endLine: line, endColumn: 1, matchText: '' },
    context: { startLine: line, endLine: line, lines: [] },
    message: `${ruleId} message`,
    source: 'fixture',
    status,
  };
}

const A = '/repo/proj/src/foo.ts';
const B = '/repo/proj/src/bar.ts';

describe('topCounts', () => {
  it('sorts by count desc, then key asc, trims to top N', () => {
    const counts = new Map([
      ['b', 5],
      ['a', 5],
      ['c', 2],
      ['d', 7],
    ]);
    expect(topCounts(counts, 3)).toEqual([
      ['d', 7],
      ['a', 5],
      ['b', 5],
    ]);
  });

  it('returns empty for empty input', () => {
    expect(topCounts(new Map(), 5)).toEqual([]);
  });

  it('handles top larger than the input', () => {
    const counts = new Map([['a', 1]]);
    expect(topCounts(counts, 10)).toEqual([['a', 1]]);
  });
});

describe('computeStats', () => {
  it('counts by severity, rule, file, and surfaces the total', () => {
    const findings = [
      makeFinding('csharp.x', 'error', A, 1),
      makeFinding('csharp.x', 'error', A, 2),
      makeFinding('csharp.y', 'warning', A, 3),
      makeFinding('csharp.z', 'suggestion', B, 4),
      makeFinding('csharp.z', 'suggestion', B, 5),
    ];
    const summary = computeStats(findings, CWD, 5);

    expect(summary.total).toBe(5);
    expect(summary.fileCount).toBe(2);
    expect(summary.bySeverity).toEqual([
      ['error', 2, 0],
      ['warning', 1, 0],
      ['suggestion', 2, 0],
    ]);
    expect(summary.byRule).toEqual([
      ['csharp.x', 2],
      ['csharp.z', 2],
      ['csharp.y', 1],
    ]);
    expect(summary.byFile).toEqual([
      ['src/foo.ts', 3],
      ['src/bar.ts', 2],
    ]);
    expect(summary.reviewCount).toBe(0);
  });

  it('separates pending review findings from violation counts', () => {
    const findings = [
      makeFinding('csharp.review', 'warning', A, 1, 'pending'),
      makeFinding('csharp.review', 'warning', A, 2, 'pending'),
      makeFinding('csharp.real', 'warning', A, 3, 'violation'),
    ];
    const summary = computeStats(findings, CWD, 5);
    expect(summary.reviewCount).toBe(2);
    expect(summary.total).toBe(1);
    expect(summary.byRule).toEqual([['csharp.real', 1]]);
  });

  it('tracks suppressed (accepted) findings per severity separately', () => {
    const findings = [
      makeFinding('csharp.accepted', 'warning', A, 1, 'accepted'),
      makeFinding('csharp.accepted', 'warning', A, 2, 'accepted'),
      makeFinding('csharp.real', 'warning', A, 3, 'violation'),
    ];
    const summary = computeStats(findings, CWD, 5);
    expect(summary.total).toBe(1);
    expect(summary.bySeverity).toEqual([
      ['error', 0, 0],
      ['warning', 1, 2],
      ['suggestion', 0, 0],
    ]);
  });

  it('trims byRule / byFile to the top N', () => {
    const findings: Finding[] = [];
    for (let i = 0; i < 8; i++) {
      findings.push(makeFinding(`rule.${String(i)}`, 'warning', `${A}.${String(i)}`, i));
    }
    const summary = computeStats(findings, CWD, 3);
    expect(summary.byRule.length).toBe(3);
    expect(summary.byFile.length).toBe(3);
  });
});

describe('loadStatsHistory / saveStatsHistory', () => {
  it('returns [] when the cache file is missing', () => {
    expect(loadStatsHistory(join(tmpRoot, '.regent/cache.json'))).toEqual([]);
  });

  it('returns [] when the cache file is malformed JSON', () => {
    const cachePath = join(tmpRoot, '.regent/cache.json');
    mkdirSync(join(tmpRoot, '.regent'), { recursive: true });
    writeFileSync(cachePath, '{not json', 'utf8');
    expect(loadStatsHistory(cachePath)).toEqual([]);
  });

  it('returns [] when statsHistory is missing', () => {
    const cachePath = join(tmpRoot, '.regent/cache.json');
    mkdirSync(join(tmpRoot, '.regent'), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ header: {}, entries: {} }), 'utf8');
    expect(loadStatsHistory(cachePath)).toEqual([]);
  });

  it('round-trips a 5-snapshot history', () => {
    const cachePath = join(tmpRoot, '.regent/cache.json');
    const history: StatsHistoryEntry[] = [
      { at: 100, total: 60 },
      { at: 200, total: 58 },
      { at: 300, total: 56 },
      { at: 400, total: 54 },
      { at: 500, total: 52 },
    ];
    saveStatsHistory(cachePath, history);
    expect(loadStatsHistory(cachePath)).toEqual(history);
  });

  it('preserves other cache fields when saving statsHistory', () => {
    const cachePath = join(tmpRoot, '.regent/cache.json');
    mkdirSync(join(tmpRoot, '.regent'), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({ header: { schemaVersion: 1 }, entries: { foo: 'bar' } }),
      'utf8',
    );
    saveStatsHistory(cachePath, [{ at: 1, total: 1 }]);
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>;
    expect(parsed['header']).toEqual({ schemaVersion: 1 });
    expect(parsed['entries']).toEqual({ foo: 'bar' });
    expect(parsed['statsHistory']).toEqual([{ at: 1, total: 1 }]);
  });

  it('trims history to the last STATS_HISTORY_MAX entries', () => {
    const cachePath = join(tmpRoot, '.regent/cache.json');
    const oversized: StatsHistoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
      at: i,
      total: i,
    }));
    saveStatsHistory(cachePath, oversized);
    expect(loadStatsHistory(cachePath)).toEqual(oversized.slice(-STATS_HISTORY_MAX));
    expect(loadStatsHistory(cachePath).length).toBe(STATS_HISTORY_MAX);
  });

  it('skips malformed history entries silently', () => {
    const cachePath = join(tmpRoot, '.regent/cache.json');
    mkdirSync(join(tmpRoot, '.regent'), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        statsHistory: [
          { at: 'no', total: 0 },
          null,
          { at: 1, total: 5 },
          'string',
          { at: 2 },
        ],
      }),
      'utf8',
    );
    expect(loadStatsHistory(cachePath)).toEqual([{ at: 1, total: 5 }]);
  });
});

describe('renderStatsText', () => {
  const summary: StatsSummary = {
    total: 10,
    fileCount: 4,
    bySeverity: [
      ['error', 5, 1],
      ['warning', 3, 0],
      ['suggestion', 2, 0],
    ],
    byRule: [['csharp.x', 5], ['csharp.y', 3], ['csharp.z', 2]],
    byFile: [['src/a.ts', 7], ['src/b.ts', 3]],
    reviewCount: 0,
  };

  it('renders the by-severity / by-rule / by-file / total block', () => {
    const out = renderStatsText('regent', summary, [], false);
    expect(out).toContain('regent stats — regent');
    expect(out).toContain('error: 5  (1 suppressed)');
    expect(out).toContain('warning: 3');
    expect(out).toContain('suggestion: 2');
    expect(out).toContain('csharp.x  5');
    expect(out).toContain('Total: 10 findings across 4 files');
  });

  it('emits "insufficient history" when fewer than STATS_HISTORY_MAX snapshots exist', () => {
    const out = renderStatsText('regent', summary, [
      { at: 1, total: 10 },
    ], false);
    expect(out).toContain('insufficient history');
    expect(out).toContain('(1 of 5 runs)');
  });

  it('emits the trend arrow + verdict with 5 snapshots', () => {
    const history: StatsHistoryEntry[] = [
      { at: 1, total: 60 },
      { at: 2, total: 58 },
      { at: 3, total: 56 },
      { at: 4, total: 54 },
      { at: 5, total: 52 },
    ];
    const out = renderStatsText('regent', summary, history, false);
    expect(out).toMatch(/Trend \(last 5 runs\): 60 → 58 → 56 → 54 → 52 \(8 better\)/);
  });

  it('emits "(no change)" when first equals last', () => {
    const history: StatsHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      at: i,
      total: 10,
    }));
    const out = renderStatsText('regent', summary, history, false);
    expect(out).toContain('(no change)');
  });

  it('emits "worse" verdict when total grows', () => {
    const history: StatsHistoryEntry[] = [
      { at: 1, total: 5 },
      { at: 2, total: 5 },
      { at: 3, total: 5 },
      { at: 4, total: 5 },
      { at: 5, total: 7 },
    ];
    const out = renderStatsText('regent', summary, history, false);
    expect(out).toContain('(2 worse)');
  });

  it('renders the "no check run" hint when summary is null', () => {
    const out = renderStatsText('regent', null, [], false);
    expect(out).toContain('no check run');
  });

  it('surfaces the review count when present', () => {
    const withReview: StatsSummary = { ...summary, reviewCount: 4 };
    const out = renderStatsText('regent', withReview, [], false);
    expect(out).toContain('review: 4');
  });
});

describe('renderStatsJson', () => {
  it('returns the documented JSON shape (with summary)', () => {
    const summary: StatsSummary = {
      total: 6,
      fileCount: 2,
      bySeverity: [['error', 6, 0], ['warning', 0, 0], ['suggestion', 0, 0]],
      byRule: [['csharp.x', 6]],
      byFile: [['src/foo.ts', 6]],
      reviewCount: 0,
    };
    const history: StatsHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      at: i,
      total: 10 - i,
    }));
    const json = renderStatsJson('regent', summary, history);
    expect(json['project']).toBe('regent');
    expect(json['historySufficient']).toBe(true);
    const sum = json['summary'] as Record<string, unknown>;
    expect(sum['total']).toBe(6);
    expect(sum['fileCount']).toBe(2);
    expect(sum['reviewCount']).toBe(0);
    expect((sum['byRule'] as Record<string, number>)['csharp.x']).toBe(6);
    expect((sum['byFile'] as Record<string, number>)['src/foo.ts']).toBe(6);
    expect(json['history']).toEqual(history);
  });

  it('returns null summary + historySufficient=false when there is no run yet', () => {
    const json = renderStatsJson('regent', null, []);
    expect(json['project']).toBe('regent');
    expect(json['summary']).toBe(null);
    expect(json['historySufficient']).toBe(false);
    expect(json['history']).toEqual([]);
  });

  it('historySufficient is true at exactly STATS_HISTORY_MAX snapshots', () => {
    const history = Array.from({ length: STATS_HISTORY_MAX }, (_, i) => ({ at: i, total: i }));
    const json = renderStatsJson('regent', null, history);
    expect(json['historySufficient']).toBe(true);
  });
});