import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

import type { Finding } from '../types.js';

void relative;

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly missing?: boolean;
}

export type AnnotationCommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<CommandResult>;

export interface AnnotatePrOptions {
  readonly cwd?: string;
  readonly runCommand?: AnnotationCommandRunner;
}

export async function annotateFindings(
  prNumber: number,
  findings: readonly Finding[],
  options: AnnotatePrOptions = {},
): Promise<number> {
  if (findings.length === 0) {
    writeSummary(0, 0, 0);
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
  let skipped = 0;
  let failed = 0;
  let existingBodies = comments.stdout;

  for (const finding of findings) {
    const path = annotationPath(finding.path, cwd);
    const line = finding.match.startLine + 1;
    const marker = annotationMarker(finding.ruleId, path, line);
    if (existingBodies.includes(marker)) {
      skipped++;
      continue;
    }

    const body = annotationBody(finding, marker);
    const result = await runCommand(
      'gh',
      [
        'api',
        `repos/{owner}/{repo}/pulls/${String(prNumber)}/comments`,
        '--method',
        'POST',
        '-f',
        `body=${body}`,
        '-f',
        `commit_id=${commitId}`,
        '-f',
        `path=${path}`,
        '-F',
        `line=${String(line)}`,
        '-f',
        'side=RIGHT',
      ],
      cwd,
    );
    if (result.code === 0) {
      posted++;
      existingBodies += `\n${marker}`;
    } else {
      failed++;
    }
  }

  writeSummary(posted, skipped, failed);
  return failed === 0 ? 0 : 1;
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

function writeSummary(posted: number, skipped: number, failed: number): void {
  process.stderr.write(
    `posted ${String(posted)}, skipped ${String(skipped)} (duplicates), failed ${String(failed)}\n`,
  );
}

function formatCommandError(result: CommandResult): string {
  const message = result.stderr.trim();
  return message === '' ? '' : `: ${message}`;
}

function runProcess(command: string, args: readonly string[], cwd: string): Promise<CommandResult> {
  return new Promise((complete) => {
    const child = spawn(command, [...args], { cwd, windowsHide: true });
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
  });
}
