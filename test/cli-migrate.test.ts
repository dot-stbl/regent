/**
 * L1: regent migrate — read tools/audit/config.ts, write .regentrc.ts.
 *
 * Uses the compiled CLI (dist/cli.js) so we exercise the real surface
 * (commander dispatch, file I/O, exit codes).
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

const REPO = mkdtempSync(join(tmpdir(), 'regent-migrate-'));

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = execFile(process.execPath, [CLI, ...args], { cwd: REPO }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout, stderr });
    });
    proc.on('error', reject);
  });
}

beforeAll(() => {
  mkdirSync(join(REPO, 'tools', 'audit'), { recursive: true });
  // Legacy v0.1-style config: rules.add[] with detect rules + a fix rule.
  writeFileSync(
    join(REPO, 'tools', 'audit', 'config.js'),
    `export default {
  rules: {
    add: [
      {
        id: 'legacy.no-region',
        severity: 'error',
        pattern: '\\\\s*#region\\\\b',
        globs: ['**/*.cs'],
        message: 'no #region',
      },
      {
        id: 'legacy.fix-trailing',
        severity: 'warning',
        find: '\\\\s+\\$',
        replace: '',
        globs: ['**/*'],
        message: 'trailing whitespace',
      },
    ],
  },
};`,
  );
});

afterAll(() => {
  rmSync(REPO, { recursive: true, force: true });
});

describe('regent migrate', () => {
  it('converts legacy config.ts → .regentrc.ts', async () => {
    const r = await runCli(['migrate']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/migrated/);

    const newPath = join(REPO, '.regentrc.ts');
    expect(existsSync(newPath)).toBe(true);

    const content = readFileSync(newPath, 'utf8');
    expect(content).toContain('legacy.no-region');
    expect(content).toContain('legacy.fix-trailing');
    // Fix rules land in rules.fix[], detect in rules.detect[].
    expect(content).toMatch(/"fix":\s*\[[\s\S]*legacy\.fix-trailing[\s\S]*\]/);
    expect(content).toMatch(/"detect":\s*\[[\s\S]*legacy\.no-region[\s\S]*\]/);
  });

  it('no-ops when no legacy config exists', async () => {
    // Use a separate clean tmpdir.
    const empty = mkdtempSync(join(tmpdir(), 'regent-migrate-empty-'));
    const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const proc = execFile(process.execPath, [CLI, 'migrate'], { cwd: empty }, (err, stdout, stderr) => {
        resolve({ code: err?.code ?? 0, stdout, stderr });
      });
      proc.on('error', reject);
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/no legacy/);
    rmSync(empty, { recursive: true, force: true });
  });
});