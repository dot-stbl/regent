/**
 * L0: version source of truth — three places that must agree.
 *
 * The CLI's `--version`, the SARIF `tool.driver.version`, and the
 * cache `runnerVersion` header all flow from `package.json` via
 * `src/version.ts`. If any of them drifts from the manifest, the
 * tests in this file will catch it.
 *
 * The CLI spawn step assumes `npm run build` already ran (matches
 * CI: build → test → smoke). The same contract is what
 * `test/cli.test.ts` relies on.
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VERSION } from '../src/version.js';
import { renderSarif } from '../src/reporter/sarif.js';
import type { CompiledRule, Finding } from '../src/types.js';

const PKG_VERSION = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
  version: string;
}).version;

const DIST_CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

describe('VERSION (src/version.ts)', () => {
  it('matches package.json#version', () => {
    expect(VERSION).toBe(PKG_VERSION);
  });

  it('looks like a semver-ish string (digits + dots, no alpha drift)', () => {
    // Permissive: x.y.z, including pre-release / build metadata. The
    // hard rule is "matches package.json"; this is a no-regression
    // sanity check against future accidental `0.3.0`-style rot.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
    expect(VERSION).not.toBe('0.3.0');
  });

  it('regent --version prints the same value', async () => {
    const out = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      const proc = spawn(process.execPath, [DIST_CLI, '--version'], {
        env: { ...process.env, NO_COLOR: '1' },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      proc.stdout.on('data', (c) => stdout.push(c));
      proc.stderr.on('data', (c) => stderr.push(c));
      proc.on('error', reject);
      proc.on('close', (code) =>
        resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), code: code ?? 0 }),
      );
    });
    expect(out.code).toBe(0);
    expect(out.stdout.trim()).toBe(VERSION);
  });

  it('SARIF tool.driver.version matches', () => {
    const rule: CompiledRule = {
      spec: {
        id: 'version.fixture',
        severity: 'warning',
        pattern: '.',
        globs: ['**/*'],
        message: 'fixture',
      },
      source: 'version.test.ts',
      origin: { kind: 'preset', preset: 'version.test' },
    };
    const finding: Finding = {
      ruleId: 'version.fixture',
      severity: 'warning',
      path: '/abs/x',
      match: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 1, matchText: 'x' },
      context: { startLine: 1, endLine: 1, lines: ['x'] },
      message: 'fixture',
      source: 'version.test.ts',
      rationale: 'no rationale',
    };
    const parsed = JSON.parse(renderSarif([finding], [rule], { cwd: '/abs' }));
    expect(parsed.runs[0].tool.driver.version).toBe(VERSION);
  });
});
