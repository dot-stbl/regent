/**
 * L3: CLI smoke — spawn `node dist/cli.js` against a tmp repo and assert
 * exit code + basic output shape.
 */

import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = join(tmpdir(), `regent-cli-smoke-${Date.now()}`);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

beforeAll(async () => {
  mkdirSync(REPO, { recursive: true });
  // We need to wait for build before this test runs.
  writeFileSync(
    join(REPO, 'Bad.cs'),
    `public class A {\n    #region\n    int x;\n    #endregion\n}\n`,
  );
});

afterAll(() => {
  rmSync(REPO, { recursive: true, force: true });
});

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO,
      env: { ...process.env, NO_COLOR: '1' },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on('data', (chunk) => stdout.push(chunk));
    proc.stderr.on('data', (chunk) => stderr.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

describe('cli (smoke)', () => {
  it('prints help on --help', async () => {
    const r = await runCli(['--help']);
    expect(r.stdout).toContain('Usage:');
    expect(r.stdout).toContain('regent');
  });

  it('prints regent + by .stbl banner on --help', async () => {
    const r = await runCli(['--help']);
    expect(r.stdout).toContain('regent');
    expect(r.stdout).toContain('by');
    expect(r.stdout).toContain('.stbl');
    expect(r.stdout).toMatch(/─+/);  // accent line (─ U+2500)
    expect(r.stdout).toContain('\u2588');  // .stbl mark (█ U+2588)
  });

  it('check: emits SARIF when --format sarif', async () => {
    const r = await runCli(['check', '--all', '--format', 'sarif']);
    expect(r.stdout).toContain('"version": "2.1.0"');
    expect(r.stdout).toContain('csharp.no-region-directive');
  });

  it('check: exits 1 on findings (no clean input)', async () => {
    const r = await runCli(['check', '--all']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('csharp.no-region-directive');
  });

  it('list: prints at least the csharp preset rules', async () => {
    const r = await runCli(['list']);
    expect(r.stdout).toContain('csharp.no-region-directive');
    expect(r.stdout).toContain('csharp.no-private-methods');
  });

  it('explain: shows rule metadata', async () => {
    const r = await runCli(['explain', 'csharp.no-region-directive']);
    expect(r.stdout).toContain('csharp.no-region-directive');
    expect(r.stdout).toContain('Source:');
  });

  it('init: creates tools/audit/ scaffolding', async () => {
    const r = await runCli(['init']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('created');
  });

  void execFile;
});
