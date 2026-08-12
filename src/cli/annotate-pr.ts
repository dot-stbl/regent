import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

import type { Finding } from '../types.js';

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly missing?: boolean;
}

export interface AnnotationCommandOptions {
  readonly stdin?: string;
}

export type AnnotationCommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
  options?: AnnotationCommandOptions,
) => Promise<CommandResult>;

export interface AnnotatePrOptions {
  readonly cwd?: string;
  readonly runCommand?: AnnotationCommandRunner;
}

interface PullFile {
  readonly filename: string;
  readonly status: string;
  readonly patch?: string | null;
}

/** Right-side (new-file) line numbers that appear in the PR diff, keyed by path. */
export type DiffLineIndex = ReadonlyMap<string, ReadonlySet<number>>;

export async function annotateFindings(
  prNumber: number,
  findings: readonly Finding[],
  options: AnnotatePrOptions = {},
): Promise<number> {
  if (findings.length === 0) {
    writeSummary(0, 0, 0, 0);
    return 0;
  }
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    process.stderr.write('regent: --annotate-pr must be a positive pull request number.\n');
    return 2;
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  const runCommand = options.runCommand ?? runProcess;
  const repository = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], cwd);
  if (repository.code !== 0 || repository.stdout.trim() !== 'true') {
    process.stderr.write('regent: --annotate-pr must be run inside a git repository.\n');
    return 2;
  }

  const pull = await runCommand(
    'gh',
    ['api', `repos/{owner}/{repo}/pulls/${String(prNumber)}`, '--jq', '.head.sha'],
    cwd,
  );
  if (pull.missing === true) {
    process.stderr.write(
      'regent: GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ and authenticate with `gh auth login`.\n',
    );
    return 2;
  }
  if (pull.code !== 0 || pull.stdout.trim() === '') {
    process.stderr.write(
      `regent: pull request #${String(prNumber)} was not found or is inaccessible${formatCommandError(pull)}.\n`,
    );
    return 2;
  }

  const files = await runCommand(
    'gh',
    [
      'api',
      `repos/{owner}/{repo}/pulls/${String(prNumber)}/files`,
      '--paginate',
    ],
    cwd,
  );
  if (files.code !== 0) {
    process.stderr.write(
      `regent: could not read PR #${String(prNumber)} changed files${formatCommandError(files)}.\n`,
    );
    return 2;
  }

  const diffLines = parsePullFiles(files.stdout);
  if (diffLines.size === 0) {
    process.stderr.write(
      `regent: PR #${String(prNumber)} has no annotatable diff lines (empty or binary-only changes).\n`,
    );
    writeSummary(0, 0, findings.length, 0);
    return 0;
  }

  const comments = await runCommand(
    'gh',
    [
      'api',
      `repos/{owner}/{repo}/pulls/${String(prNumber)}/comments`,
      '--paginate',
      '--jq',
      '.[].body',
    ],
    cwd,
  );
  if (comments.code !== 0) {
    process.stderr.write(`regent: could not read existing PR comments${formatCommandError(comments)}.\n`);
    return 2;
  }

  const commitId = pull.stdout.trim();
  let posted = 0;
  let skippedDuplicates = 0;
  let skippedOutOfDiff = 0;
  let failed = 0;
  let existingBodies = comments.stdout;

  for (const finding of findings) {
    const path = annotationPath(finding.path, cwd);
    const line = finding.match.startLine + 1;
    const marker = annotationMarker(finding.ruleId, path, line);

    if (existingBodies.includes(marker)) {
      skippedDuplicates++;
      continue;
    }

    if (!isOnDiff(diffLines, path, line)) {
      skippedOutOfDiff++;
      continue;
    }

    const body = annotationBody(finding, marker);
    const payload = JSON.stringify({
      body,
      commit_id: commitId,
      path,
      line,
      side: 'RIGHT',
    });
    const result = await runCommand(
      'gh',
      [
        'api',
        `repos/{owner}/{repo}/pulls/${String(prNumber)}/comments`,
        '--method',
        'POST',
        '--input',
        '-',
      ],
      cwd,
      { stdin: payload },
    );
    if (result.code === 0) {
      posted++;
      existingBodies += `\n${marker}`;
    } else {
      failed++;
      const detail = result.stderr.trim() === ''
        ? `exit ${String(result.code)}`
        : result.stderr.trim();
      process.stderr.write(
        `regent: failed to annotate ${path}:${String(line)} (${finding.ruleId}): ${detail}\n`,
      );
    }
  }

  writeSummary(posted, skippedDuplicates, skippedOutOfDiff, failed);
  return failed === 0 ? 0 : 1;
}

/** Parse GitHub pull-files JSON into a path → right-side line set index. */
export function parsePullFiles(raw: string): DiffLineIndex {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return new Map();
  }

  const files = normalizePullFiles(parsed);
  const index = new Map<string, Set<number>>();

  for (const file of files) {
    if (file.status === 'removed') {
      continue;
    }
    const path = file.filename.replaceAll('\\', '/');
    const lines = parsePatchRightLines(file.patch ?? undefined);
    if (lines.size === 0) {
      // No patch (binary / too large): skip — GitHub will 422 any line comment.
      continue;
    }
    const existing = index.get(path);
    if (existing === undefined) {
      index.set(path, lines);
    } else {
      for (const line of lines) {
        existing.add(line);
      }
    }
  }

  return index;
}

/** Extract right-side (new-file) line numbers from a unified diff patch. */
export function parsePatchRightLines(patch: string | undefined): Set<number> {
  const lines = new Set<number>();
  if (patch === undefined || patch === '') {
    return lines;
  }

  let newLine = 0;
  for (const rawLine of patch.split('\n')) {
    if (rawLine.startsWith('@@')) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
      if (match?.[1] === undefined) {
        newLine = 0;
        continue;
      }
      newLine = Number.parseInt(match[1], 10);
      continue;
    }
    if (newLine === 0) {
      continue;
    }
    if (rawLine.startsWith('+')) {
      lines.add(newLine);
      newLine += 1;
      continue;
    }
    if (rawLine.startsWith('-')) {
      continue;
    }
    if (rawLine.startsWith('\\')) {
      // "\ No newline at end of file"
      continue;
    }
    // Context line (leading space) or empty hunk line.
    lines.add(newLine);
    newLine += 1;
  }

  return lines;
}

function normalizePullFiles(parsed: unknown): PullFile[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isPullFile);
  }
  // --paginate can yield concatenated arrays in some gh versions; also accept a single object.
  if (isPullFile(parsed)) {
    return [parsed];
  }
  return [];
}

function isPullFile(value: unknown): value is PullFile {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.filename === 'string' && typeof record.status === 'string';
}

function isOnDiff(diffLines: DiffLineIndex, path: string, line: number): boolean {
  const lines = diffLines.get(path);
  return lines !== undefined && lines.has(line);
}

function annotationBody(finding: Finding, marker: string): string {
  const column = finding.match.startColumn + 1;
  const explanation = finding.rationale?.trim()
    || `See \`${finding.source}\` for the rule definition and rationale.`;
  return [
    finding.message,
    '',
    `**Rule:** \`${finding.ruleId}\` (${finding.severity}) at column ${String(column)}. ${explanation}`,
    '',
    marker,
  ].join('\n');
}

function annotationMarker(ruleId: string, path: string, line: number): string {
  // Pipe-separated (rule|path|line) so dots, dashes, and slashes in the
  // rule id / path stay human-readable and never collide with the
  // marker shell. Picked over URL-encoding to keep the dedupe marker
  // trivially copy-pasteable in PR review threads.
  const escapedRule = ruleId.replaceAll('|', '||');
  const escapedPath = path.replaceAll('|', '||');
  return `<!-- regent:${escapedRule}|${escapedPath}|${String(line)} -->`;
}

function annotationPath(path: string, cwd: string): string {
  const repoRelative = isAbsolute(path) ? relative(cwd, path) : path;
  return repoRelative.replaceAll('\\', '/').replace(/^\.\//, '');
}

function writeSummary(
  posted: number,
  skippedDuplicates: number,
  skippedOutOfDiff: number,
  failed: number,
): void {
  process.stderr.write(
    `posted ${String(posted)}, skipped ${String(skippedDuplicates)} (duplicates), out-of-diff ${String(skippedOutOfDiff)}, failed ${String(failed)}\n`,
  );
}

function formatCommandError(result: CommandResult): string {
  const message = result.stderr.trim();
  return message === '' ? '' : `: ${message}`;
}

function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  options: AnnotationCommandOptions = {},
): Promise<CommandResult> {
  return new Promise((complete) => {
    const child = spawn(command, [...args], {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      complete({
        code: 2,
        stdout: '',
        stderr: error.message,
        missing: error.code === 'ENOENT',
      });
    });
    child.on('close', (code) => {
      complete({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    if (child.stdin !== null) {
      if (options.stdin !== undefined) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    }
  });
}
