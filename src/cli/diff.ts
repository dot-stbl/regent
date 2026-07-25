#!/usr/bin/env -S node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';

import { loadRules } from '../loader.js';
import { runRules } from '../runner.js';
import { runDelegates } from '../runner/delegate.js';
import { renderJson, withScannedFiles } from '../reporter/json.js';
import type { JsonFinding, JsonRunResult } from '../reporter/json.js';
import { flushAndExit } from '../logging/index.js';

export type DiffFormat = 'text' | 'json';

export interface DiffOptions {
  readonly cwd?: string;
  readonly format?: DiffFormat;
  readonly currentRun?: JsonRunResult;
}

export interface FindingDiff {
  readonly baseline: string;
  readonly new: readonly JsonFinding[];
  readonly resolved: readonly JsonFinding[];
}

export function cachedDiffPath(cwd: string): string {
  return join(cwd, '.regent', 'diff-baseline.json');
}

export function saveCachedDiff(run: JsonRunResult, cwd: string): void {
  const path = cachedDiffPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

export function computeFindingDiff(
  baseline: JsonRunResult,
  current: JsonRunResult,
  baselineLabel: string,
): FindingDiff {
  const before = new Map(baseline.findings.map((finding) => [findingKey(finding), finding]));
  const after = new Map(current.findings.map((finding) => [findingKey(finding), finding]));
  const newFindings = [...after].filter(([key]) => !before.has(key)).map(([, finding]) => finding);
  const resolved = [...before].filter(([key]) => !after.has(key)).map(([, finding]) => finding);
  return {
    baseline: baselineLabel,
    new: sortFindings(newFindings),
    resolved: sortFindings(resolved),
  };
}

export function renderDiffText(diff: FindingDiff): string {
  if (diff.new.length === 0 && diff.resolved.length === 0) {
    return '';
  }
  const rows = [
    ...diff.new.map((finding) => renderRow('+ new', finding)),
    ...diff.resolved.map((finding) => renderRow('- resolved', finding)),
  ];
  return [
    'STATUS      FILE:LINE                       RULE                          SEVERITY',
    ...rows,
    '',
    `${String(diff.new.length)} new, ${String(diff.resolved.length)} resolved`,
    '',
  ].join('\n');
}

export async function runDiff(
  baseline: string | undefined,
  options: DiffOptions = {},
): Promise<number> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const format = options.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    process.stderr.write(`regent: unsupported diff format '${String(format)}'; use text or json.\n`);
    return 2;
  }

  let loadedBaseline: { label: string; run: JsonRunResult };
  try {
    loadedBaseline = loadBaseline(baseline, cwd);
  } catch (error) {
    process.stderr.write(`regent: ${(error as Error).message}\n`);
    return 2;
  }

  let current: JsonRunResult;
  try {
    current = options.currentRun ?? await runCurrentCheck(cwd);
  } catch (error) {
    process.stderr.write(`regent: current check failed: ${(error as Error).message}\n`);
    return 1;
  }

  const diff = computeFindingDiff(loadedBaseline.run, current, loadedBaseline.label);
  saveCachedDiff(current, cwd);
  process.stdout.write(
    format === 'json'
      ? `${JSON.stringify(diff, null, 2)}\n`
      : renderDiffText(diff),
  );
  return 0;
}

export function registerDiffCommand(program: Command): void {
  program
    .command('diff [baseline]')
    .description('Show new and resolved findings since a cached run or JSON baseline')
    .option('--cwd <path>', 'repository root', '.')
    .option('--format <fmt>', 'output format (text|json)', 'text')
    .action(async (baseline: string | undefined, options: { cwd?: string; format?: DiffFormat }) => {
      const code = await runDiff(baseline, options);
      await flushAndExit(code);
    });
}

function loadBaseline(
  baseline: string | undefined,
  cwd: string,
): { label: string; run: JsonRunResult } {
  if (baseline === undefined || baseline === 'cached') {
    const path = cachedDiffPath(cwd);
    return {
      label: 'cached',
      run: existsSync(path) ? readJsonRun(path) : emptyRun(),
    };
  }
  if (baseline.startsWith('git:') || !looksLikePath(baseline)) {
    throw new Error(`git baseline '${baseline.replace(/^git:/, '')}' is not supported yet; see issue #120.`);
  }
  const rawPath = baseline.startsWith('path:') ? baseline.slice(5) : baseline;
  const path = resolve(cwd, rawPath);
  if (!existsSync(path)) {
    throw new Error(`baseline file not found: ${path}`);
  }
  return { label: `path:${path}`, run: readJsonRun(path) };
}

function readJsonRun(path: string): JsonRunResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`could not parse baseline JSON at ${path}: ${(error as Error).message}`);
  }
  if (!isJsonRun(parsed)) {
    throw new Error(`baseline JSON at ${path} is not regent check --format json output`);
  }
  return parsed;
}

async function runCurrentCheck(cwd: string): Promise<JsonRunResult> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    const loaded = await loadRules({ repoRoot: cwd });
    const result = await runRules(loaded.rules, {
      cwd,
      includeGlobs: ['**/*'],
      excludeGlobs: ['**/node_modules/**', '**/dist/**', '**/bin/**', '**/obj/**', '**/.git/**'],
      changedOnly: false,
      diffBase: 'HEAD',
    }, {
      acceptList: loaded.acceptList,
      astRules: loaded.astRules,
      concurrency: loaded.resolvedConfig.runner.concurrency,
      contextBuffer: loaded.resolvedConfig.output.contextBuffer,
    });
    const delegates = await runDelegates(
      loaded.delegateSpecs,
      loaded.resolvedConfig.rules.configure,
    );
    return withScannedFiles(
      renderJson([...result.findings, ...delegates], result.rules, { cwd }),
      result.scannedFiles,
    );
  } finally {
    process.chdir(previousCwd);
  }
}

function isJsonRun(value: unknown): value is JsonRunResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['rules'])
    && Array.isArray(candidate['findings'])
    && candidate['findings'].every(isJsonFinding)
    && typeof candidate['scannedFiles'] === 'number';
}

function isJsonFinding(value: unknown): value is JsonFinding {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const finding = value as Record<string, unknown>;
  const match = finding['match'];
  return typeof finding['ruleId'] === 'string'
    && (finding['severity'] === 'suggestion' || finding['severity'] === 'warning' || finding['severity'] === 'error')
    && typeof finding['path'] === 'string'
    && typeof match === 'object'
    && match !== null
    && typeof (match as Record<string, unknown>)['line'] === 'number'
    && typeof finding['message'] === 'string';
}

function emptyRun(): JsonRunResult {
  return { rules: [], findings: [], scannedFiles: 0 };
}

function findingKey(finding: JsonFinding): string {
  return `${finding.ruleId}\u0000${finding.path.replaceAll('\\', '/')}\u0000${String(finding.match.line)}`;
}

function sortFindings(findings: readonly JsonFinding[]): readonly JsonFinding[] {
  return [...findings].sort((left, right) => findingKey(left).localeCompare(findingKey(right)));
}

function renderRow(status: string, finding: JsonFinding): string {
  const location = `${finding.path}:${String(finding.match.line)}`;
  return `${status.padEnd(11)} ${location.padEnd(31)} ${finding.ruleId.padEnd(29)} ${finding.severity}`;
}

function looksLikePath(value: string): boolean {
  return value.startsWith('path:') || value.endsWith('.json') || value.includes('/') || value.includes('\\');
}
