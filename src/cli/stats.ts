#!/usr/bin/env -S node
// `regent stats` — project summary statistics + a 5-run trend (#13).
//
//   regent stats                   human-readable text (default)
//   regent stats --format json     machine-readable
//   regent stats --cached          skip the fresh check — show only the trend
//   regent stats --top <N>         rows in by-rule / by-file tables (default 5)
//
// Trend data lives in the existing on-disk cache (`.regent/cache.json`)
// under a top-level `statsHistory` field — each invocation appends a
// `{at, total}` snapshot and the file is trimmed to the last 5. We do
// NOT introduce a new on-disk file.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';

import { loadRules } from '../loader.js';
import { runRules } from '../runner.js';
import { runDelegates } from '../runner/delegate.js';
import { defaultCachePath } from '../core/cache.js';
import type { Finding, RunnerScope, Severity } from '../types.js';
import { flushAndExit } from '../logging/index.js';

export type StatsFormat = 'text' | 'json';

/** Number of snapshots we keep in the cache file's `statsHistory`. */
export const STATS_HISTORY_MAX = 5;

/** One trend snapshot — kept tiny on purpose so 5 entries fit in a
 *  few hundred bytes of the existing cache file. */
export interface StatsHistoryEntry {
  readonly at: number;
  readonly total: number;
}

/** Project summary along the four axes the spec asks for. */
export interface StatsSummary {
  readonly total: number;
  readonly fileCount: number;
  readonly bySeverity: ReadonlyArray<readonly [Severity, number, number]>;
  /** Top-N tuples `[ruleId, count]` already trimmed + sorted. */
  readonly byRule: ReadonlyArray<readonly [string, number]>;
  readonly byFile: ReadonlyArray<readonly [string, number]>;
  readonly reviewCount: number;
}

export interface StatsOptions {
  readonly cwd?: string;
  readonly format?: StatsFormat;
  /** When `true`, skip the live check; show only the trend from the cache. */
  readonly cached?: boolean;
  readonly top?: number;
  readonly configPath?: string;
}

/** Sort a count map by count desc, then key asc, trim to `top`. */
export function topCounts(
  counts: ReadonlyMap<string, number>,
  top: number,
): ReadonlyArray<readonly [string, number]> {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, top));
}

/** Compute the four-axis summary from a finding set. `cwd` is used to
 *  collapse absolute paths to repo-relative for the by-file table. */
export function computeStats(
  findings: readonly Finding[],
  cwd: string,
  top: number,
): StatsSummary {
  const bySeverityRaw = new Map<Severity, number>([
    ['error', 0],
    ['warning', 0],
    ['suggestion', 0],
  ]);
  const suppressed = new Map<Severity, number>([
    ['error', 0],
    ['warning', 0],
    ['suggestion', 0],
  ]);
  const byRule = new Map<string, number>();
  const byFile = new Map<string, number>();
  let reviewCount = 0;

  for (const f of findings) {
    if (f.status === 'pending') {
      reviewCount++;
      continue;
    }
    if (f.status === 'accepted') {
      suppressed.set(f.severity, (suppressed.get(f.severity) ?? 0) + 1);
      continue;
    }
    bySeverityRaw.set(f.severity, (bySeverityRaw.get(f.severity) ?? 0) + 1);
    byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
    const rel = toRepoRelative(f.path, cwd);
    byFile.set(rel, (byFile.get(rel) ?? 0) + 1);
  }

  const bySeverity: ReadonlyArray<readonly [Severity, number, number]> = [
    ['error', bySeverityRaw.get('error') ?? 0, suppressed.get('error') ?? 0],
    ['warning', bySeverityRaw.get('warning') ?? 0, suppressed.get('warning') ?? 0],
    ['suggestion', bySeverityRaw.get('suggestion') ?? 0, suppressed.get('suggestion') ?? 0],
  ];

  return {
    total: byRule.size === 0 ? 0 : [...byRule.values()].reduce((acc, n) => acc + n, 0),
    fileCount: byFile.size,
    bySeverity,
    byRule: topCounts(byRule, top),
    byFile: topCounts(byFile, top),
    reviewCount,
  };
}

/** Repo-relative path — mirrors `src/reporter/json.ts:toRepoRelative`.
 *  Duplicated here so stats doesn't reach into the reporter package
 *  for a single helper, and so tests can use absolute paths. */
function toRepoRelative(filepath: string, cwd: string): string {
  const split = (s: string): readonly string[] =>
    s.split(/[\\/]+/).filter((segment) => segment.length > 0);
  const fileParts = split(filepath);
  const cwdParts = split(cwd);
  let i = 0;
  while (
    i < fileParts.length
    && i < cwdParts.length
    && fileParts[i] === cwdParts[i]
  ) {
    i++;
  }
  return fileParts.slice(i).join('/');
}

/** Project name = cwd's last directory segment. */
function projectName(cwd: string): string {
  if (cwd === '.' || cwd === '') return basename(resolve(cwd));
  const parts = cwd.split(/[\\/]+/).filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? cwd;
}

/** Read the optional `statsHistory` array from the on-disk cache JSON.
 *  Returns `[]` on miss / parse error. */
export function loadStatsHistory(cachePath: string): readonly StatsHistoryEntry[] {
  if (!existsSync(cachePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as { statsHistory?: unknown };
    if (!Array.isArray(parsed.statsHistory)) return [];
    const out: StatsHistoryEntry[] = [];
    for (const item of parsed.statsHistory) {
      if (
        item !== null
        && typeof item === 'object'
        && typeof (item as { at?: unknown }).at === 'number'
        && typeof (item as { total?: unknown }).total === 'number'
      ) {
        out.push({ at: (item as { at: number }).at, total: (item as { total: number }).total });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Trim history to `STATS_HISTORY_MAX`, write the cache JSON back
 *  atomically. We bypass `DiskCache` because its `flush()` writes
 *  only `{header, entries}` and would drop our field — documented
 *  in the header comment. */
export function saveStatsHistory(
  cachePath: string,
  history: readonly StatsHistoryEntry[],
): void {
  let payload: Record<string, unknown> = {};
  if (existsSync(cachePath)) {
    try {
      payload = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  payload['statsHistory'] = history.slice(-STATS_HISTORY_MAX);

  const dir = dirname(cachePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const text = JSON.stringify(payload);
  const tmp = `${cachePath}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, cachePath);
}

/** Pretty-print the human-readable text output. */
export function renderStatsText(
  project: string,
  summary: StatsSummary | null,
  history: readonly StatsHistoryEntry[],
  useColor: boolean,
): string {
  const dim = useColor ? pc.dim : identity;
  const bold = useColor ? pc.bold : identity;
  const lines: string[] = [];

  lines.push(`${bold('regent stats')} ${dim('—')} ${bold(project)}`);
  lines.push('');

  if (summary !== null) {
    lines.push(`${bold('By severity:')}`);
    for (const [sev, count, supp] of summary.bySeverity) {
      const tail = supp > 0 ? `  ${dim(`(${String(supp)} suppressed)`)}` : '';
      lines.push(`  ${sev}: ${String(count)}${tail}`);
    }
    if (summary.reviewCount > 0) {
      lines.push(`  review: ${String(summary.reviewCount)}`);
    }
    lines.push('');

    if (summary.byRule.length > 0) {
      lines.push(`${bold(`By rule (top ${String(summary.byRule.length)}):`)}`);
      const w = Math.max(...summary.byRule.map(([id]) => id.length));
      for (const [id, count] of summary.byRule) {
        lines.push(`  ${id.padEnd(w)}  ${String(count)}`);
      }
      lines.push('');
    }

    if (summary.byFile.length > 0) {
      lines.push(`${bold(`By file (top ${String(summary.byFile.length)}):`)}`);
      const w = Math.max(...summary.byFile.map(([p]) => p.length));
      for (const [p, count] of summary.byFile) {
        lines.push(`  ${p.padEnd(w)}  ${String(count)}`);
      }
      lines.push('');
    }

    lines.push(`${bold('Total:')} ${String(summary.total)} findings across ${String(summary.fileCount)} files`);
  } else {
    lines.push(dim('(no check run — drop --cached or run `regent check` first)'));
  }

  lines.push('');
  if (history.length < STATS_HISTORY_MAX) {
    lines.push(`${bold('Trend:')} ${dim('insufficient history')} ${dim(`(${String(history.length)} of ${String(STATS_HISTORY_MAX)} runs)`)}`);
    return `${lines.join('\n')}\n`;
  }
  const arrow = useColor ? pc.dim('→') : '→';
  const series = history.map((h) => String(h.total)).join(` ${arrow} `);
  const first = history[0]!.total;
  const last = history[history.length - 1]!.total;
  const delta = first - last;
  const verdict = delta === 0
    ? dim('(no change)')
    : delta > 0 ? `(${String(delta)} better)` : `(${String(-delta)} worse)`;
  lines.push(`${bold('Trend')} ${dim(`(last ${String(STATS_HISTORY_MAX)} runs):`)} ${series} ${verdict}`);
  return `${lines.join('\n')}\n`;
}

/** JSON output — every field is JSON-serialisable, shape is stable so
 *  agents / dashboards can diff between releases. */
export function renderStatsJson(
  project: string,
  summary: StatsSummary | null,
  history: readonly StatsHistoryEntry[],
): Record<string, unknown> {
  return {
    project,
    summary: summary === null
      ? null
      : {
          total: summary.total,
          fileCount: summary.fileCount,
          reviewCount: summary.reviewCount,
          bySeverity: Object.fromEntries(
            summary.bySeverity.map(([sev, count, supp]) => [sev, { count, suppressed: supp }]),
          ),
          byRule: Object.fromEntries(summary.byRule),
          byFile: Object.fromEntries(summary.byFile),
        },
    history: history.map((h) => ({ at: h.at, total: h.total })),
    historySufficient: history.length >= STATS_HISTORY_MAX,
  };
}

function identity(s: string): string {
  return s;
}

/** Run a fresh check and return its findings. Mirrors `runCurrentCheck`
 *  in `cli/diff.ts` — the two commands diverge in what they do with
 *  the result, not how they collect it. */
async function runFreshCheck(cwd: string, _configPath: string): Promise<readonly Finding[]> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    const loaded = await loadRules({ repoRoot: cwd });
    const scope: RunnerScope = {
      cwd,
      includeGlobs: ['**/*'],
      excludeGlobs: ['**/node_modules/**', '**/dist/**', '**/bin/**', '**/obj/**', '**/.git/**'],
      changedOnly: false,
      diffBase: 'HEAD',
    };
    const result = await runRules(loaded.rules, scope, {
      acceptList: loaded.acceptList,
      contextBuffer: loaded.resolvedConfig.output.contextBuffer,
      concurrency: loaded.resolvedConfig.runner.concurrency,
      astRules: loaded.astRules,
    });
    const delegates = await runDelegates(loaded.delegateSpecs, loaded.resolvedConfig.rules.configure);
    return [...result.findings, ...delegates];
  } finally {
    process.chdir(previousCwd);
  }
}

/** Top-level entry — used by the CLI subcommand and by tests. */
export async function runStats(options: StatsOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? 'tools/audit/config.ts';
  const format: StatsFormat = options.format ?? 'text';
  const top = options.top ?? 5;
  const useColor = pc.isColorSupported && !process.env['NO_COLOR'];

  const cachePath = defaultCachePath(cwd);
  const priorHistory = loadStatsHistory(cachePath);
  const project = projectName(cwd);

  let summary: StatsSummary | null = null;
  let newHistory = priorHistory;

  if (!options.cached) {
    let findings: readonly Finding[];
    try {
      findings = await runFreshCheck(cwd, configPath);
    } catch (err) {
      process.stderr.write(`regent: ${(err as Error).message}\n`);
      return 1;
    }
    summary = computeStats(findings, cwd, top);
    const entry: StatsHistoryEntry = { at: Date.now(), total: summary.total };
    newHistory = [...priorHistory, entry].slice(-STATS_HISTORY_MAX);
    try {
      saveStatsHistory(cachePath, newHistory);
    } catch (err) {
      process.stderr.write(`regent: could not save stats history: ${(err as Error).message}\n`);
    }
  }

  process.stdout.write(
    format === 'json'
      ? `${JSON.stringify(renderStatsJson(project, summary, newHistory), null, 2)}\n`
      : renderStatsText(project, summary, newHistory, useColor),
  );
  return 0;
}

/** Register `regent stats` on a Commander program. Wired into
 *  `src/cli.ts`; tests invoke `runStats()` directly. */
export function registerStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Show summary statistics — by severity, by rule, by file, with a 5-run trend.')
    .option('--config <path>', 'config path', 'tools/audit/config.ts')
    .option('--scope <dir>', 'scope directory', '.')
    .option('--format <fmt>', 'output format (text|json)', 'text')
    .option('--cached', 'read trend only — skip the fresh check')
    .option('--top <n>', 'rows in the by-rule / by-file tables', (value) => Number.parseInt(value, 10), 5)
    .action(async (options: { config?: string; scope?: string; format?: StatsFormat; cached?: boolean; top?: number }) => {
      const code = await runStats({
        cwd: options.scope ?? process.cwd(),
        configPath: options.config ?? 'tools/audit/config.ts',
        ...(options.format !== undefined ? { format: options.format } : {}),
        ...(options.cached === true ? { cached: true } : {}),
        ...(options.top !== undefined ? { top: options.top } : {}),
      });
      await flushAndExit(code);
    });
}