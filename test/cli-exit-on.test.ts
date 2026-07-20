/**
 * L3: `check --exit-on` severity gating (regression test for #8).
 *
 * A `warning`-severity violation must fail CI only when `--exit-on` is at
 * or below `warning`. Before the fix, `computeExitCode` ignored the
 * threshold and returned 1 for any violation regardless of severity, so
 * `--exit-on` was a no-op.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = join(tmpdir(), `regent-exit-on-${Date.now()}`);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

function runCli(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO,
      env: { ...process.env, NO_COLOR: '1' },
    });
    const stdout: Buffer[] = [];
    proc.stdout.on('data', (c) => stdout.push(c));
    proc.on('error', reject);
    proc.on('close', (code) =>
      resolve({ code: code ?? 0, stdout: Buffer.concat(stdout).toString('utf8') }),
    );
  });
}

beforeAll(() => {
  mkdirSync(REPO, { recursive: true });
  writeFileSync(
    join(REPO, 'Bad.cs'),
    `public class A {\n    #region\n    int x;\n    #endregion\n}\n`,
  );
  // A single warning-severity rule so we can probe the threshold from
  // both sides (error is above it, warning is at it).
  writeFileSync(
    join(REPO, '.regentrc.js'),
    `export default {
  rules: {
    detect: [
      {
        id: 'gate.no-region',
        severity: 'warning',
        pattern: '\\\\s*#region\\\\b',
        globs: ['**/*.cs'],
        message: 'no #region',
      },
    ],
  },
};`,
  );
});

afterAll(() => {
  rmSync(REPO, { recursive: true, force: true });
});

describe('check --exit-on severity gating', () => {
  it('reports but does NOT fail a warning finding when --exit-on error', async () => {
    const r = await runCli(['check', '--all', '--exit-on', 'error']);
    expect(r.stdout).toContain('gate.no-region'); // still displayed
    expect(r.code).toBe(0);                        // below the error threshold
  });

  it('fails a warning finding when --exit-on warning', async () => {
    const r = await runCli(['check', '--all', '--exit-on', 'warning']);
    expect(r.code).toBe(1);
  });
});
