/**
 * L3: CLI scope × changed-only intersection (re-implementation of #106
 * against the current `--scope <dir>` / `--all` architecture).
 *
 * The original PR #142 added a per-scope `changedOnly` flag inside a
 * `scopes:` config block. That block was deleted on main; the current
 * architecture exposes scope routing via the `--scope <dir>` CLI flag
 * and a single global `changedOnly: !options.all` switch.
 *
 * The PR keeps the goal of #106 — intersect scope × git-changed —
 * by:
 *
 *   1. Making `--scope <dir>` actually narrow the runner cwd (the flag
 *      was parsed but ignored in `runCheck` on main; `stats` /
 *      `describe` were the only consumers that used it).
 *   2. Adding `--changed-only` as an explicit, additive flag whose
 *      semantics match the existing default (only-changed files).
 *
 * When `--changed-only` is set together with `--scope <dir>`, the
 * runner's `collectChangedFiles` naturally returns only files under
 * the scope root (git's diff output is repo-relative; simple-git
 * resolves the repo from `cwd`, then absolute paths are joined with
 * the scope cwd).
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(tmpdir(), `regent-scope-changed-only-${Date.now()}`);
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
      env: { ...process.env, NO_COLOR: '1' },
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
      `dist/cli.js not found at ${CLI} — run \`npm run build\` first`,
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

interface RepoFixture {
  /** Files written + committed at baseline (repo-relative paths). */
  baseline: string[];
  /** Files written + staged AFTER the baseline commit (repo-relative). */
  changed: string[];
}

/**
 * Set up a small git repo with tracked baseline files (committed) and
 * staged "changed" files (post-commit, `git add`'d, no commit). The
 * runner's `collectChangedFiles` picks staged + unstaged + HEAD..base
 * files; this fixture uses the staged set so we control exactly which
 * paths appear as "changed".
 */
function initRepo(cwd: string, fixture: RepoFixture): void {
  mkdirSync(cwd, { recursive: true });
  writeFile(
    cwd,
    '.regentrc.js',
    `export default {
  rules: {
    detect: [
      {
        id: 'scope-changed-only.test-marker',
        severity: 'error',
        pattern: 'CHANGED-MARKER',
        globs: ['**/*.txt'],
        message: 'test marker',
      },
    ],
  },
};`,
  );
  for (const rel of fixture.baseline) {
    writeFile(cwd, rel, 'baseline\n');
  }
  runGit(['init', '--quiet'], cwd);
  runGit(['config', 'user.email', 'regent-test@example.invalid'], cwd);
  runGit(['config', 'user.name', 'Regent Test'], cwd);
  runGit(['add', '-A'], cwd);
  runGit(['commit', '--quiet', '--no-gpg-sign', '-m', 'baseline'], cwd);

  // After commit, write the "changed" files and stage them — they
  // appear in `git diff --cached` so `collectChangedFiles` returns
  // them.
  for (const rel of fixture.changed) {
    writeFile(cwd, rel, 'CHANGED-MARKER\n');
  }
  if (fixture.changed.length > 0) {
    runGit(['add', '-A'], cwd);
  }
}

interface RunJson {
  findings: Array<{ ruleId: string; file: string }>;
  scannedFiles: number;
}

function parseJson(stdout: string): RunJson | null {
  const idx = stdout.indexOf('{');
  if (idx < 0) return null;
  try {
    return JSON.parse(stdout.slice(idx)) as RunJson;
  } catch {
    return null;
  }
}

function scannedFiles(stdout: string): number {
  return parseJson(stdout)?.scannedFiles ?? -1;
}

function findingFiles(stdout: string): string[] {
  return (parseJson(stdout)?.findings ?? []).map((f) => f.file);
}

beforeAll(() => {
  ensureBuilt();
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('regent check: --scope × --changed-only intersection (issue #106)', () => {
  it('default behavior (no flag): cwd, changed-only — unchanged from current main', async () => {
    const repo = join(ROOT, 'default');
    initRepo(repo, {
      baseline: ['apps/web/keep.txt', 'apps/backend/keep.txt'],
      changed: ['apps/web/new.txt'],
    });

    const r = await runCli(
      [
        'check',
        '--format',
        'json',
        '--include-rules',
        'scope-changed-only.test-marker',
      ],
      repo,
    );
    expect(r.code).toBe(1);
    // The default is changed-only at cwd. Only `apps/web/new.txt` is
    // changed → exactly one scanned file, exactly one finding.
    expect(scannedFiles(r.stdout)).toBe(1);
    expect(findingFiles(r.stdout)).toHaveLength(1);
  });

  it('--changed-only flag: same as default — explicit, no behaviour change', async () => {
    const repo = join(ROOT, 'explicit');
    initRepo(repo, {
      baseline: ['apps/web/keep.txt', 'apps/backend/keep.txt'],
      changed: ['apps/web/new.txt'],
    });

    const r = await runCli(
      [
        'check',
        '--changed-only',
        '--format',
        'json',
        '--include-rules',
        'scope-changed-only.test-marker',
      ],
      repo,
    );
    expect(r.code).toBe(1);
    expect(scannedFiles(r.stdout)).toBe(1);
  });

  it('--changed-only + --scope <dir>: only changed files under that scope', async () => {
    const repo = join(ROOT, 'intersect');
    initRepo(repo, {
      baseline: ['apps/web/baseline.txt', 'apps/backend/baseline.txt'],
      changed: [
        'apps/web/feat.txt', // changed + IN scope → scanned
        'apps/backend/api.txt', // changed + OUT of scope → skipped
      ],
    });

    const r = await runCli(
      [
        'check',
        '--changed-only',
        '--scope',
        'apps/web',
        '--format',
        'json',
        '--include-rules',
        'scope-changed-only.test-marker',
      ],
      repo,
    );
    expect(r.code).toBe(1);
    // Only the changed file under apps/web is in the scan set.
    expect(scannedFiles(r.stdout)).toBe(1);
    expect(findingFiles(r.stdout)).toHaveLength(1);
  });

  it('--changed-only + --all: warn and fall back to scanning every file', async () => {
    const repo = join(ROOT, 'conflict');
    initRepo(repo, {
      baseline: ['apps/web/baseline.txt', 'apps/backend/baseline.txt'],
      changed: ['apps/web/new.txt'],
    });

    const r = await runCli(
      [
        'check',
        '--changed-only',
        '--all',
        '--format',
        'json',
        '--include-rules',
        'scope-changed-only.test-marker',
      ],
      repo,
    );
    expect(r.stderr).toContain('--changed-only conflicts with --all');
    // `--all` overrides — both baseline files AND the changed file
    // are scanned (≥ 3 files total).
    expect(scannedFiles(r.stdout)).toBeGreaterThanOrEqual(3);
  });

  it('no git repo: collectChangedFiles returns [] — graceful fallback (no findings)', async () => {
    const repo = join(ROOT, 'no-git');
    mkdirSync(repo, { recursive: true });
    writeFile(
      repo,
      '.regentrc.js',
      `export default {
  rules: {
    detect: [
      {
        id: 'scope-changed-only.test-marker',
        severity: 'error',
        pattern: 'CHANGED-MARKER',
        globs: ['**/*.txt'],
        message: 'test marker',
      },
    ],
  },
};`,
    );
    writeFile(repo, 'present.txt', 'CHANGED-MARKER\n');

    const r = await runCli(
      [
        'check',
        '--changed-only',
        '--format',
        'json',
        '--include-rules',
        'scope-changed-only.test-marker',
      ],
      repo,
    );
    // Without git, `collectChangedFiles` returns [] so the scan
    // produces no findings (exit 0).
    expect(r.code).toBe(0);
    expect(findingFiles(r.stdout)).toEqual([]);
  });

  it('--scope <dir> without --changed-only: scope narrows the scan, default changed-only still applies', async () => {
    const repo = join(ROOT, 'scope-default');
    initRepo(repo, {
      baseline: ['apps/web/old.txt', 'apps/backend/old.txt'],
      changed: ['apps/web/new.txt', 'apps/backend/api.txt'],
    });

    const r = await runCli(
      [
        'check',
        '--scope',
        'apps/web',
        '--format',
        'json',
        '--include-rules',
        'scope-changed-only.test-marker',
      ],
      repo,
    );
    expect(r.code).toBe(1);
    // Only `apps/web/new.txt` is changed AND under the scope — the
    // other changed file (`apps/backend/api.txt`) is filtered out.
    expect(scannedFiles(r.stdout)).toBe(1);
  });
});

void execFileSync;