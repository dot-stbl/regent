/**
 * L3: `regent check --diff` / `--diff <ref>` (issue #129).
 *
 * Pre-commit / lint-staged invoke `regent check --diff`. Under Commander
 * 15 unknown options hard-fail; this suite asserts the flag parses,
 * appears in help, and runs a smoke check on a clean git tree.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(tmpdir(), `regent-check-diff-${Date.now()}`);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolveOne, reject) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
        STBL_REGENT_NO_UPDATE_CHECK: '1',
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on('data', (chunk) => stdout.push(chunk));
    proc.stderr.on('data', (chunk) => stderr.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      resolveOne({
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function ensureBuilt(): void {
  if (!existsSync(CLI)) {
    throw new Error(
      `dist/cli.js not found at ${CLI} — run \`bun run build\` first`,
    );
  }
}

function runGit(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`,
    );
  }
}

function writeFile(repo: string, rel: string, content: string): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

beforeAll(() => {
  ensureBuilt();
  mkdirSync(ROOT, { recursive: true });
  writeFile(
    ROOT,
    '.regentrc.js',
    `export default {
  rules: {
    detect: [
      {
        id: 'check-diff.test-marker',
        severity: 'error',
        pattern: 'CHANGED-MARKER',
        globs: ['**/*.txt'],
        message: 'test marker',
      },
    ],
  },
};`,
  );
  writeFile(ROOT, 'ok.txt', 'clean baseline\n');
  runGit(['init'], ROOT);
  runGit(['config', 'user.email', 'regent@test'], ROOT);
  runGit(['config', 'user.name', 'regent'], ROOT);
  runGit(['add', '.'], ROOT);
  runGit(['commit', '-m', 'baseline'], ROOT);
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('regent check --diff (issue #129)', () => {
  it('check --help documents --diff', async () => {
    const r = await runCli(['check', '--help'], ROOT);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--diff');
    expect(r.stderr).not.toContain('unknown option');
  });

  it('check --diff parses without unknown option error', async () => {
    const r = await runCli(['check', '--diff'], ROOT);
    expect(r.stderr).not.toContain('unknown option');
    // Clean tree + no marker → exit 0 (or 0 findings).
    expect(r.code).toBe(0);
  });

  it('check --diff HEAD parses and runs (optional ref form)', async () => {
    const r = await runCli(['check', '--diff', 'HEAD'], ROOT);
    expect(r.stderr).not.toContain('unknown option');
    expect(r.code).toBe(0);
  });

  it('check --diff HEAD~0 accepts ref alias of --diff-base', async () => {
    const r = await runCli(['check', '--diff', 'HEAD~0'], ROOT);
    expect(r.stderr).not.toContain('unknown option');
    expect(r.code).toBe(0);
  });

  it('check --diff finds staged changes only', async () => {
    writeFile(ROOT, 'dirty.txt', 'CHANGED-MARKER\n');
    runGit(['add', 'dirty.txt'], ROOT);
    try {
      const r = await runCli(
        ['check', '--diff', '--include-rules', 'check-diff.test-marker'],
        ROOT,
      );
      expect(r.stderr).not.toContain('unknown option');
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('check-diff.test-marker');
    } finally {
      runGit(['rm', '-f', 'dirty.txt'], ROOT);
    }
  });
});
