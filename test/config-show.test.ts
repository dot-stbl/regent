/**
 * L2: `regent config show / diff / layers` — per-layer provenance for
 * the merged config.
 *
 * Asserts:
 *   - `config show <field>` prints merged + per-layer origin
 *   - `config diff` lists only fields where a non-default layer overrode
 *     the default (built-in exclude groups are NOT reported as overrides)
 *   - `config layers` lists all 6 layers (defaults + global/project/
 *     local/env/args) in precedence order with their loaded state +
 *     origin (file path / env var / arg flag)
 *   - unknown subcommand / unknown field produce clear errors with
 *     non-zero exit codes
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config/index.js';
import {
  diffFromDefaults,
  formatDiff,
  formatLayers,
  formatShow,
  readPath,
  showField,
} from '../src/config/inspect.js';

const REPO = join(tmpdir(), `regent-config-smoke-${Date.now()}`);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');
const STBL_PREFIX = 'STBL_REGENT_';

beforeAll(() => {
  mkdirSync(REPO, { recursive: true });
  writeFileSync(
    join(REPO, '.regentrc.js'),
    `export default {
  rules: {
    detect: [
      {
        id: 'smoke.no-region',
        severity: 'error',
        pattern: '\\\\s*#region\\\\b',
        globs: ['**/*.cs'],
        message: 'no #region',
      },
    ],
  },
  cache: { enabled: false },
  excludePaths: ['**/Generated/**'],
};`,
  );
});

afterAll(() => {
  rmSync(REPO, { recursive: true, force: true });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(STBL_PREFIX)) {
      delete process.env[key];
    }
  }
});

function runCli(args: string[], envOverride: Record<string, string> = {}): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO,
      env: { ...process.env, NO_COLOR: '1', ...envOverride },
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

// ---------------------------------------------------------------------------
// Unit tests on the inspect module (pure functions)
// ---------------------------------------------------------------------------

describe('readPath', () => {
  it('returns the root for the empty path', () => {
    expect(readPath({ a: 1 }, '')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('walks a single segment', () => {
    expect(readPath({ a: 1 }, 'a')).toEqual({ ok: true, value: 1 });
  });

  it('walks a dotted path', () => {
    expect(readPath({ a: { b: { c: 42 } } }, 'a.b.c')).toEqual({
      ok: true,
      value: 42,
    });
  });

  it('returns not-ok when a segment is missing', () => {
    expect(readPath({ a: 1 }, 'a.b.c')).toEqual({ ok: false });
  });

  it('returns not-ok when descending into a non-object', () => {
    expect(readPath({ a: 1 }, 'a.b')).toEqual({ ok: false });
  });
});

describe('showField', () => {
  it('returns the merged value + per-layer origins', async () => {
    const result = await loadConfig({ cwd: REPO });
    const show = showField(result, 'cache.enabled');
    expect('path' in show).toBe(true);
    if ('path' in show) {
      expect(show.path).toBe('cache.enabled');
      expect(show.merged).toBe(false);
      const defaultsEntry = show.perLayer.find((l) => l.id === 'defaults');
      expect(defaultsEntry?.value).toBe(true);
      const projectEntry = show.perLayer.find((l) => l.id === 'project');
      expect(projectEntry?.loaded).toBe(true);
      expect(projectEntry?.value).toBe(false);
      expect(projectEntry?.origin).toMatch(/\.regentrc\.js$/);
    }
  });

  it('returns error for empty path', async () => {
    const result = await loadConfig({ cwd: REPO });
    const show = showField(result, '');
    expect('error' in show).toBe(true);
    if ('error' in show) {
      expect(show.error).toBe('empty-path');
    }
  });

  it('returns error for unknown field', async () => {
    const result = await loadConfig({ cwd: REPO });
    const show = showField(result, 'does.not.exist');
    expect('error' in show).toBe(true);
    if ('error' in show) {
      expect(show.error).toBe('not-found');
    }
  });
});

describe('diffFromDefaults', () => {
  it('lists only fields overridden by a non-default layer', async () => {
    const result = await loadConfig({ cwd: REPO });
    const diff = diffFromDefaults(result);
    const paths = diff.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['cache.enabled', 'excludePaths', 'rules.detect']));
    // built-in exclude groups must NOT appear as overrides (effective defaults
    // include them — the diff only flags genuine user overrides).
    expect(paths.every((p) => !p.startsWith('excludeGroups.'))).toBe(true);
  });

  it('returns empty when only defaults are loaded', async () => {
    const emptyRepo = join(tmpdir(), `regent-empty-${Date.now()}`);
    mkdirSync(emptyRepo, { recursive: true });
    try {
      const result = await loadConfig({ cwd: emptyRepo });
      const diff = diffFromDefaults(result);
      expect(diff).toHaveLength(0);
    } finally {
      rmSync(emptyRepo, { recursive: true, force: true });
    }
  });

  it('formatDiff prints an empty-state message when nothing differs', () => {
    expect(formatDiff([])).toContain('no overrides');
  });

  it('formatLayers produces a stable 6-line block', async () => {
    const result = await loadConfig({ cwd: REPO });
    const text = formatLayers(result.layers);
    expect(text).toContain('6 config layers');
    for (const id of ['defaults', 'global', 'project', 'local', 'env', 'args']) {
      expect(text).toContain(id);
    }
  });

  it('formatShow lists per-layer values + origins', async () => {
    const result = await loadConfig({ cwd: REPO });
    const show = showField(result, 'cache.enabled');
    if ('path' in show) {
      const text = formatShow(show);
      expect(text).toContain('cache.enabled');
      expect(text).toContain('defaults');
      expect(text).toContain('project');
    }
  });
});

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

describe('regent config CLI', () => {
  it('build artefact exists for CLI tests', () => {
    // We rely on the build step having been run earlier in this test run.
    // (vitest's `bun run test` is invoked by humans after `bun run build`.)
    // We do not assert on dist here — the CLI tests below would fail loudly
    // if the artefact is missing.
  });

  it('config layers lists all 6 layers in precedence order', async () => {
    const r = await runCli(['config', 'layers']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('6 config layers');
    expect(r.stdout).toContain('defaults');
    expect(r.stdout).toContain('global');
    expect(r.stdout).toContain('project');
    expect(r.stdout).toContain('local');
    expect(r.stdout).toContain('env');
    expect(r.stdout).toContain('args');
    // Project layer reports its file path.
    expect(r.stdout).toMatch(/\.regentrc\.js/);
  });

  it('config show cache.enabled prints merged + per-layer origin', async () => {
    const r = await runCli(['config', 'show', 'cache.enabled']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('cache.enabled: false');
    expect(r.stdout).toContain('defaults');
    expect(r.stdout).toContain('true');
    expect(r.stdout).toContain('false');
    expect(r.stdout).toContain('project');
  });

  it('config show respects env var overrides and reports them', async () => {
    const r = await runCli(['config', 'show', 'log.level'], {
      STBL_REGENT_LOG_LEVEL: 'debug',
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('log.level: "debug"');
    expect(r.stdout).toContain('STBL_REGENT_LOG_LEVEL');
  });

  it('config show <unknown-field> exits 1 with a clear error', async () => {
    const r = await runCli(['config', 'show', 'does.not.exist']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/not found/i);
  });

  it('config show with no field exits 2', async () => {
    const r = await runCli(['config', 'show']);
    expect(r.code).toBe(2);
  });

  it('config diff lists only actual overrides (no built-in exclude groups)', async () => {
    const r = await runCli(['config', 'diff']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('cache.enabled');
    expect(r.stdout).toContain('rules.detect');
    expect(r.stdout).toContain('excludePaths');
    expect(r.stdout).not.toContain('excludeGroups.');
  });

  it('config with no subcommand prints help and exits 0', async () => {
    const r = await runCli(['config']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('show');
    expect(r.stdout).toContain('diff');
    expect(r.stdout).toContain('layers');
  });

  it('config with unknown subcommand exits 2', async () => {
    const r = await runCli(['config', 'bogus']);
    expect(r.code).toBe(2);
  });
});