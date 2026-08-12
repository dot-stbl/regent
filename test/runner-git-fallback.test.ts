/**
 * L2: runner git-changed fallback (#162).
 *
 * Default `changedOnly: true` must not silently scan 0 files when git
 * is unavailable or the diff base is invalid — warn + fall back to a
 * full glob scan instead.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { defineRule } from '../src/define-rule.js';
import { runRules } from '../src/runner.js';

const ROOT = join(tmpdir(), `regent-git-fallback-${Date.now()}`);

const MARKER = defineRule({
  id: 'git-fallback.test-marker',
  severity: 'error',
  pattern: 'CHANGED-MARKER',
  globs: ['**/*.txt'],
  message: 'test marker',
});

function writeFile(dir: string, rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function runGit(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('runRules git changed-only fallback (#162)', () => {
  it('not a git repo: warns on stderr and full-scans files', async () => {
    const dir = join(ROOT, 'not-a-repo');
    mkdirSync(dir, { recursive: true });
    writeFile(dir, 'present.txt', 'CHANGED-MARKER\n');
    writeFile(dir, 'clean.txt', 'ok\n');

    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const result = await runRules([MARKER], {
        cwd: dir,
        includeGlobs: ['**/*.txt'],
        excludeGlobs: [],
        changedOnly: true,
        diffBase: 'HEAD',
      });

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.path.replace(/\\/g, '/')).toMatch(/present\.txt$/);
      expect(result.scannedFiles).toBeGreaterThanOrEqual(1);

      const messages = stderr.mock.calls
        .map((call) => String(call[0]))
        .join('');
      expect(messages).toMatch(/git changed-files lookup failed/i);
      expect(messages).toMatch(/falling back to full scan/i);
      expect(messages).toMatch(/not a git repository/i);
    } finally {
      stderr.mockRestore();
    }
  });

  it('invalid diffBase: warns on stderr and full-scans files', async () => {
    const dir = join(ROOT, 'bad-diff-base');
    mkdirSync(dir, { recursive: true });
    writeFile(dir, 'present.txt', 'CHANGED-MARKER\n');
    runGit(['init'], dir);
    runGit(['config', 'user.email', 'test@example.com'], dir);
    runGit(['config', 'user.name', 'test'], dir);
    runGit(['add', '.'], dir);
    runGit(['commit', '-m', 'init'], dir);

    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const result = await runRules([MARKER], {
        cwd: dir,
        includeGlobs: ['**/*.txt'],
        excludeGlobs: [],
        changedOnly: true,
        diffBase: 'this-ref-does-not-exist-zzzz',
      });

      // Fallback full-scans the committed present.txt.
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.path.replace(/\\/g, '/')).toMatch(/present\.txt$/);

      const messages = stderr.mock.calls
        .map((call) => String(call[0]))
        .join('');
      expect(messages).toMatch(/git changed-files lookup failed/i);
      expect(messages).toMatch(/falling back to full scan/i);
    } finally {
      stderr.mockRestore();
    }
  });

  it('successful git-changed path: only changed files, no fallback warning', async () => {
    const dir = join(ROOT, 'good-git');
    mkdirSync(dir, { recursive: true });
    writeFile(dir, 'baseline.txt', 'baseline\n');
    runGit(['init'], dir);
    runGit(['config', 'user.email', 'test@example.com'], dir);
    runGit(['config', 'user.name', 'test'], dir);
    runGit(['add', '.'], dir);
    runGit(['commit', '-m', 'init'], dir);

    // Staged change after baseline — collectChangedFiles should see it.
    writeFile(dir, 'changed.txt', 'CHANGED-MARKER\n');
    // Unchanged baseline with the marker must NOT be scanned under
    // changedOnly (only changed files). Put marker only on the new file.
    runGit(['add', 'changed.txt'], dir);

    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const result = await runRules([MARKER], {
        cwd: dir,
        includeGlobs: ['**/*.txt'],
        excludeGlobs: [],
        changedOnly: true,
        diffBase: 'HEAD',
      });

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.path.replace(/\\/g, '/')).toMatch(/changed\.txt$/);

      const messages = stderr.mock.calls
        .map((call) => String(call[0]))
        .join('');
      expect(messages).not.toMatch(/falling back to full scan/i);
    } finally {
      stderr.mockRestore();
    }
  });
});
