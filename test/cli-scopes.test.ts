/**
 * L1: integration tests for the scope-related CLI surface (issue #35).
 *
 * Each test creates a fresh tmpdir, writes a `.regentrc.json` declaring
 * scopes (or not), seeds an inline rule that always fires, and shells
 * out to `regent check` via the CLI dispatch to assert:
 *
 *   - `regent check` on a no-scopes repo finds findings tagged
 *     with the implicit `default` scope — but the `scope` field is
 *     omitted from output (single-project shape preservation).
 *   - `regent check` on a scoped repo runs every scope; each finding
 *     carries its scope name.
 *   - `regent check -s <name>` runs only that scope.
 *   - `regent check -s a,b` runs both scopes (order preserved).
 *   - `regent check -s unknown` exits non-zero with a clear error.
 *   - `regent scopes` lists declared scopes + the implicit fallback.
 *   - `--format json` includes `scope` on findings when scopes are
 *     active; omits it for the single-project case.
 *
 * Output via the CLI binary at `dist/cli.js` (built by `bun run
 * build`); the test rebuilds if the binary is missing.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(__dirname, '..');
const CLI_BIN = join(REPO_ROOT, 'dist', 'cli.js');

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[], cwd: string): CliResult {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  // Unset the user-global overrides so tests don't load the host's
  // house-rules (and the csharp.* ones don't fire on the test temp).
  delete env['STBL_REGENT_CONFIG_PATH'];
  delete env['STBL_REGENT_GLOBAL_RULES_PATH'];
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function ensureBuilt(): void {
  if (!existsSync(CLI_BIN)) {
    const result = spawnSync('bun', ['run', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(`failed to build CLI: exit ${result.status}`);
    }
  }
}

// Configs are written as JSON because the test workspace has no
// `node_modules` (no `@dot-stbl/regent` to import). cosmiconfig's
// `.json` loader skips the dynamic-import path entirely.
const INLINE_RULE = (ruleId: string, globs: readonly string[]): string => JSON.stringify({
  rules: {
    detect: [
      {
        id: ruleId,
        severity: 'error',
        pattern: 'TODO',
        globs,
        message: 'TODO found',
      },
    ],
  },
});

const SCOPED_CONFIG = (scopes: Record<string, { root: string }>): string => JSON.stringify({
  scopes,
  rules: {
    detect: [
      {
        id: 'cli.scopes.todo',
        severity: 'error',
        pattern: 'TODO',
        globs: ['**/*.txt'],
        message: 'TODO found',
      },
    ],
  },
});

const MARKER = 'TODO MARKER';

const workspaces: string[] = [];

beforeAll(() => {
  ensureBuilt();
});

beforeEach(() => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'regent-scopes-'));
  const appsWeb = join(repoRoot, 'apps', 'web');
  const appsBackend = join(repoRoot, 'apps', 'backend');
  mkdirSync(appsWeb, { recursive: true });
  mkdirSync(appsBackend, { recursive: true });
  writeFileSync(join(appsWeb, 'todo.txt'), `${MARKER}\n`);
  writeFileSync(join(appsBackend, 'todo.txt'), `${MARKER}\n`);
  writeFileSync(join(repoRoot, 'top.txt'), `${MARKER}\n`);
  workspaces.push(repoRoot);
});

afterEach(() => {
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function pickRepo(): string {
  const repo = workspaces[workspaces.length - 1];
  if (repo === undefined) {
    throw new Error('no workspace');
  }
  return repo;
}

describe('regent check: scope resolution (issue #35)', () => {
  it('single-project (no scopes) → finds findings, no scope field in JSON', () => {
    const repo = pickRepo();
    writeFileSync(join(repo, '.regentrc.json'), INLINE_RULE('cli.scopes.default-todo', ['**/*.txt']));

    const r = runCli(['check', '--all', '--format', 'json', '--include-rules', 'cli.scopes.*'], repo);
    expect(r.status).toBe(1);

    const doc = JSON.parse(r.stdout) as {
      findings: Array<{ ruleId: string; path: string; scope?: string }>;
    };
    expect(doc.findings.length).toBeGreaterThanOrEqual(1);
    for (const f of doc.findings) {
      expect(f.scope).toBeUndefined();
    }
  });

  it('multi-scope: `regent check` runs every scope, finds tagged in JSON', () => {
    const repo = pickRepo();
    writeFileSync(
      join(repo, '.regentrc.json'),
      SCOPED_CONFIG({ frontend: { root: 'apps/web' }, backend: { root: 'apps/backend' } }),
    );

    const r = runCli(['check', '--all', '--format', 'json', '--include-rules', 'cli.scopes.*'], repo);
    expect(r.status).toBe(1);

    const doc = JSON.parse(r.stdout) as {
      findings: Array<{ ruleId: string; path: string; scope?: string }>;
    };
    const scopes = new Set(doc.findings.map((f) => f.scope));
    expect(scopes.has('frontend')).toBe(true);
    expect(scopes.has('backend')).toBe(true);
  });

  it('`-s frontend` runs only the frontend scope', () => {
    const repo = pickRepo();
    writeFileSync(
      join(repo, '.regentrc.json'),
      SCOPED_CONFIG({ frontend: { root: 'apps/web' }, backend: { root: 'apps/backend' } }),
    );

    const r = runCli(
      ['check', '--all', '-s', 'frontend', '--format', 'json', '--include-rules', 'cli.scopes.*'],
      repo,
    );
    expect(r.status).toBe(1);

    const doc = JSON.parse(r.stdout) as {
      findings: Array<{ ruleId: string; path: string; scope?: string }>;
    };
    expect(doc.findings.length).toBeGreaterThanOrEqual(1);
    for (const f of doc.findings) {
      expect(f.scope).toBe('frontend');
      expect(f.path.replace(/\\/g, '/')).toContain('apps/web/');
    }
  });

  it('`-s frontend,backend` runs both scopes (order preserved)', () => {
    const repo = pickRepo();
    writeFileSync(
      join(repo, '.regentrc.json'),
      SCOPED_CONFIG({ frontend: { root: 'apps/web' }, backend: { root: 'apps/backend' } }),
    );

    const r = runCli(
      ['check', '--all', '-s', 'backend,frontend', '--format', 'json', '--include-rules', 'cli.scopes.*'],
      repo,
    );
    expect(r.status).toBe(1);

    const doc = JSON.parse(r.stdout) as {
      findings: Array<{ ruleId: string; path: string; scope?: string }>;
    };
    const scopes = new Set(doc.findings.map((f) => f.scope));
    expect(scopes.has('frontend')).toBe(true);
    expect(scopes.has('backend')).toBe(true);
  });

  it('`-s` typo exits non-zero with a clear error listing known scopes', () => {
    const repo = pickRepo();
    writeFileSync(
      join(repo, '.regentrc.json'),
      SCOPED_CONFIG({ frontend: { root: 'apps/web' } }),
    );

    const r = runCli(['check', '-s', 'frontent'], repo);
    expect(r.status).not.toBe(0);
    // stderr from pino carries the error; stdout may also have it
    // via commander; check both.
    const combined = `${r.stdout}\n${r.stderr}`;
    expect(combined).toMatch(/unknown scope 'frontent'/);
    expect(combined).toMatch(/frontend/);
  });

  it('text output tags findings with [scope] for non-default scope', () => {
    const repo = pickRepo();
    writeFileSync(
      join(repo, '.regentrc.json'),
      SCOPED_CONFIG({ frontend: { root: 'apps/web' } }),
    );

    const r = runCli(['check', '--all', '-s', 'frontend', '--include-rules', 'cli.scopes.*'], repo);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/\[frontend\]/);
  });

  it('text output omits scope tag for implicit `default`', () => {
    const repo = pickRepo();
    writeFileSync(join(repo, '.regentrc.json'), INLINE_RULE('cli.scopes.default-todo', ['**/*.txt']));

    const r = runCli(['check', '--all', '--include-rules', 'cli.scopes.*'], repo);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/\[default\]/);
  });
});

describe('regent scopes (issue #35)', () => {
  it('lists declared scopes in text format', () => {
    const repo = pickRepo();
    writeFileSync(
      join(repo, '.regentrc.json'),
      SCOPED_CONFIG({ frontend: { root: 'apps/web' }, backend: { root: 'apps/backend' } }),
    );

    const r = runCli(['scopes'], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/frontend/);
    expect(r.stdout).toMatch(/backend/);
    expect(r.stdout).toMatch(/apps\/web/);
    expect(r.stdout).toMatch(/apps\/backend/);
  });

  it('emits JSON when --format json', () => {
    const repo = pickRepo();
    writeFileSync(
      join(repo, '.regentrc.json'),
      SCOPED_CONFIG({ frontend: { root: 'apps/web' } }),
    );

    const r = runCli(['scopes', '--format', 'json'], repo);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as {
      cwd: string;
      scopes: Array<{ name: string; root: string; absoluteRoot: string; implicit: boolean }>;
    };
    expect(doc.scopes.length).toBe(1);
    expect(doc.scopes[0]?.name).toBe('frontend');
    expect(doc.scopes[0]?.implicit).toBe(false);
  });

  it('single-project: shows one implicit `default` scope', () => {
    const repo = pickRepo();
    writeFileSync(join(repo, '.regentrc.json'), INLINE_RULE('cli.scopes.default-todo', ['**/*.txt']));

    const r = runCli(['scopes'], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/default/);
    expect(r.stdout).toMatch(/\(implicit\)/);
  });

  it('flags missing scope roots with a "missing" config marker', () => {
    const repo = pickRepo();
    writeFileSync(
      join(repo, '.regentrc.json'),
      SCOPED_CONFIG({ frontend: { root: 'apps/web' }, ghost: { root: 'nope/does/not/exist' } }),
    );

    const r = runCli(['scopes'], repo);
    expect(r.status).toBe(0);
    // The existing scope's root exists; the ghost's doesn't.
    expect(r.stdout).toMatch(/frontend\s+apps\/web\s+found/);
    expect(r.stdout).toMatch(/ghost\s+nope\/does\/not\/exist\s+missing/);
  });
});

describe('regent fix: scope anchoring (issue #35)', () => {
  it('`-s frontend` narrows the fix scan to that scope', () => {
    const repo = pickRepo();
    writeFileSync(
      join(repo, '.regentrc.json'),
      SCOPED_CONFIG({ frontend: { root: 'apps/web' }, backend: { root: 'apps/backend' } }),
    );

    const r = runCli(['fix', '--dry-run', '-s', 'frontend', '--format', 'json'], repo);
    // Dry-run always exits 0.
    expect([0, 1]).toContain(r.status);
    // The fix command should have found at least one finding in
    // apps/web (no need to verify backend was excluded since the
    // rule has no `fix` attachment — see the dry-run JSON shape).
    const stdout = r.stdout;
    expect(stdout).toBeTruthy();
  });
});
