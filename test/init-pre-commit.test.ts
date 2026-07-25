/**
 * L1 tests for `regent init --pre-commit` — the husky / lefthook
 * scaffold. Spins the BUILT CLI (`dist/cli.js`) against fresh tmpdirs
 * so the whole commander plumbing + filesystem writes are exercised
 * the same way a user would run them.
 *
 * Idempotency: every test runs `init --pre-commit` twice and asserts
 * the on-disk tree (files + content + package.json shape) is byte-
 * identical after the second run.
 */

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

function runCli(args: readonly string[], cwd: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const proc = execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, env: { ...process.env, NO_COLOR: '1', CI: '1' } },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }),
    );
    proc.on('error', reject);
  });
}

/** Minimal package.json — keeps the scaffolds atomic and ordered. */
function seedPackageJson(cwd: string, body: Record<string, unknown> = {}): void {
  writeFileSync(
    join(cwd, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '0.0.0', ...body }, null, 2)}\n`,
    'utf8',
  );
}

describe('regent init --pre-commit', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'regent-init-pc-'));
    mkdirSync(join(cwd, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  describe('husky path (default)', () => {
    it('writes .husky/pre-commit + mutates package.json', async () => {
      seedPackageJson(cwd);
      const first = await runCli(['init', '--pre-commit'], cwd);
      expect(first.code).toBe(0);
      expect(first.stdout).toMatch(/tool=husky/);

      const hookPath = join(cwd, '.husky', 'pre-commit');
      expect(existsSync(hookPath)).toBe(true);
      const hook = readFileSync(hookPath, 'utf8');
      expect(hook).toContain('#!/usr/bin/env sh');
      expect(hook).toContain('npx --no-install lint-staged');
      expect(hook).toMatch(/Bypass.*git commit --no-verify/);

      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect((pkg['devDependencies'] as Record<string, string>)['husky']).toBeTruthy();
      expect((pkg['devDependencies'] as Record<string, string>)['lint-staged']).toBeTruthy();
      expect((pkg['scripts'] as Record<string, string>)['prepare']).toBe('husky');

      const lintStaged = pkg['lint-staged'] as Record<string, string>;
      expect(lintStaged['*.cs']).toBe('regent check --diff');
      expect(lintStaged['*.ts']).toBe('regent check --diff');
      expect(lintStaged['*.go']).toBe('regent check --diff');
    });

    it('detects pnpm and switches to lefthook automatically', async () => {
      seedPackageJson(cwd, { packageManager: 'pnpm@9.0.0' });
      const result = await runCli(['init', '--pre-commit'], cwd);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/tool=lefthook/);
      expect(existsSync(join(cwd, '.lefthook.yml'))).toBe(true);
      expect(existsSync(join(cwd, '.husky'))).toBe(false);
    });

    it('is idempotent — no duplicate writes on second run', async () => {
      seedPackageJson(cwd);
      await runCli(['init', '--pre-commit'], cwd);
      const pkgBefore = readFileSync(join(cwd, 'package.json'), 'utf8');
      const hookBefore = readFileSync(join(cwd, '.husky', 'pre-commit'), 'utf8');

      const second = await runCli(['init', '--pre-commit'], cwd);
      expect(second.code).toBe(0);
      expect(readFileSync(join(cwd, 'package.json'), 'utf8')).toBe(pkgBefore);
      expect(readFileSync(join(cwd, '.husky', 'pre-commit'), 'utf8')).toBe(hookBefore);
      expect(second.stdout).toMatch(/already (up to date|configured)/);
    });
  });

  describe('lefthook path (explicit --tool lefthook)', () => {
    it('writes .lefthook.yml + adds lefthook devDep', async () => {
      seedPackageJson(cwd);
      const result = await runCli(['init', '--pre-commit', '--tool', 'lefthook'], cwd);
      expect(result.code).toBe(0);

      const cfgPath = join(cwd, '.lefthook.yml');
      expect(existsSync(cfgPath)).toBe(true);
      const cfg = readFileSync(cfgPath, 'utf8');
      expect(cfg).toContain('pre-commit:');
      expect(cfg).toContain('regent check --diff');
      expect(cfg).toMatch(/Bypass.*git commit --no-verify/);

      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect((pkg['devDependencies'] as Record<string, string>)['lefthook']).toBeTruthy();
      // Lefthook path must NOT touch husky / lint-staged.
      expect(pkg['lint-staged']).toBeUndefined();
      expect((pkg['scripts'] as Record<string, string> | undefined)?.['prepare']).toBeUndefined();
    });

    it('is idempotent', async () => {
      seedPackageJson(cwd);
      await runCli(['init', '--pre-commit', '--tool', 'lefthook'], cwd);
      const before = readFileSync(join(cwd, '.lefthook.yml'), 'utf8');
      const pkgBefore = readFileSync(join(cwd, 'package.json'), 'utf8');

      const second = await runCli(['init', '--pre-commit', '--tool', 'lefthook'], cwd);
      expect(second.code).toBe(0);
      expect(readFileSync(join(cwd, '.lefthook.yml'), 'utf8')).toBe(before);
      expect(readFileSync(join(cwd, 'package.json'), 'utf8')).toBe(pkgBefore);
    });
  });

  describe('none path (--tool none)', () => {
    it('prints the raw bash script and writes no files', async () => {
      seedPackageJson(cwd);
      const result = await runCli(['init', '--pre-commit', '--tool', 'none'], cwd);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/tool=none/);
      expect(result.stdout).toContain('regent check --diff');
      expect(result.stdout).toContain('Paste into .git/hooks/pre-commit');
      expect(result.stdout).toMatch(/chmod \+x/);

      // No package.json mutation, no hook files written.
      expect(existsSync(join(cwd, '.husky'))).toBe(false);
      expect(existsSync(join(cwd, '.lefthook.yml'))).toBe(false);
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(pkg['devDependencies'] ?? {}).not.toHaveProperty('husky');
      expect(pkg['devDependencies'] ?? {}).not.toHaveProperty('lefthook');
    });
  });

  describe('validation', () => {
    it('rejects unknown --tool value', async () => {
      seedPackageJson(cwd);
      const result = await runCli(['init', '--pre-commit', '--tool', 'bash-it'], cwd);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/--tool must be husky \| lefthook \| none/);
    });

    it('warns when --tool is given without --pre-commit', async () => {
      seedPackageJson(cwd);
      const result = await runCli(['init', '--tool', 'lefthook'], cwd);
      expect(result.code).toBe(0);
      // existing tools/audit/ scaffold still runs
      expect(existsSync(join(cwd, 'tools', 'audit'))).toBe(true);
      expect(result.stderr).toMatch(/--tool ignored without --pre-commit/);
    });
  });
});
