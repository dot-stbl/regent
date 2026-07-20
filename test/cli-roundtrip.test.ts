/**
 * L3: CLI round-trip — exercise `init`, `accept`, `reject` end-to-end.
 *
 * Each test spawns the built `dist/cli.js` against a tmpdir, performs the
 * command, then asserts the resulting on-disk state (config.local.ts,
 * .rejections.json, scaffolded tools/audit/).
 *
 * These are the most fragile CLI paths in regent (`parseConfigText` +
 * `writeConfigFile` use regex-parsing of TS configs), so they get
 * dedicated coverage.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = join(tmpdir(), `regent-roundtrip-${Date.now()}`);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

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

beforeAll(() => {
  mkdirSync(REPO, { recursive: true });
});

afterAll(() => {
  rmSync(REPO, { recursive: true, force: true });
});

describe('cli round-trip: init', () => {
  it('scaffolds tools/audit/ with config.ts', async () => {
    const r = await runCli(['init']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/created/);

    const configPath = join(REPO, 'tools', 'audit', 'config.ts');
    expect(existsSync(configPath)).toBe(true);

    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain('defineConfig');
    // v0.2: regent ships zero rules; init scaffolds an empty config.
    expect(content).not.toContain('@dot-stbl/regent/presets/');
    // The scaffolded config has an empty rules array — no rules
    // referenced from the preset layer.
    expect(content).toMatch(/detect:\s*\[\s*\]/);
  });

  it('refuses to overwrite existing tools/audit/', async () => {
    const r = await runCli(['init']);
    expect(r.code).not.toBe(0);
    // Errors now go through pino logger → stderr NDJSON; the message
    // contains 'already exists' (capitalised by pino formatting).
    expect(r.stderr).toMatch(/already exists/i);
  });
});

describe('cli round-trip: accept', () => {
  it('writes config.local.ts with the new accept entry', async () => {
    const r = await runCli([
      'accept', 'smoke.no-todo', 'src/Foo.cs',
      '--reason', 'tracked in JIRA-123',
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('added accept entry');

    const localPath = join(REPO, 'tools', 'audit', 'config.local.ts');
    expect(existsSync(localPath)).toBe(true);

    const content = readFileSync(localPath, 'utf8');
    expect(content).toContain('smoke.no-todo');
    expect(content).toContain('src/Foo.cs');
    expect(content).toContain('tracked in JIRA-123');
  });

  it('refuses to write without --reason', async () => {
    const r = await runCli([
      'accept', 'smoke.no-todo', 'src/Bar.cs',
    ]);
    // Commander's requiredOption triggers before action handler — exit
    // code 1 (Commander default for usage errors). The action-level
    // check (runAccept returns 2) is only reached when --reason is
    // explicitly supplied but empty.
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/reason/);
  });

  it('accumulates multiple accept entries (append, not overwrite)', async () => {
    const before = readFileSync(
      join(REPO, 'tools', 'audit', 'config.local.ts'),
      'utf8',
    );

    const r = await runCli([
      'accept', 'smoke.no-region', 'src/Baz.cs',
      '--reason', 'historical file, see docs/migration.md',
    ]);
    expect(r.code).toBe(0);

    const after = readFileSync(
      join(REPO, 'tools', 'audit', 'config.local.ts'),
      'utf8',
    );
    expect(after).toContain('smoke.no-todo'); // previous entry preserved
    expect(after).toContain('smoke.no-region'); // new entry added
    expect(after.length).toBeGreaterThan(before.length);
  });
});

describe('cli round-trip: reject', () => {
  it('writes .rejections.json with the rejection entry', async () => {
    const r = await runCli([
      'reject', 'smoke.no-private-methods', 'src/Foo.cs:42',
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('added rejection');

    const rejectionsPath = join(REPO, 'tools', 'audit', '.rejections.json');
    expect(existsSync(rejectionsPath)).toBe(true);

    const content = readFileSync(rejectionsPath, 'utf8');
    expect(content).toContain('smoke.no-private-methods');
    expect(content).toContain('src/Foo.cs');
    expect(content).toContain('42');
  });

  it('refuses to reject without line number', async () => {
    const r = await runCli([
      'reject', 'smoke.no-private-methods', 'src/Bar.cs',
    ]);
    expect(r.code).toBe(2);
    // Errors come via pino → stderr NDJSON. The message text is
    // preserved; we match on a stable substring.
    expect(r.stderr).toMatch(/reject requires/i);
  });

  it('accumulates multiple rejections (no duplicates)', async () => {
    const r = await runCli([
      'reject', 'smoke.no-private-methods', 'src/Foo.cs:99',
    ]);
    expect(r.code).toBe(0);

    const after = readFileSync(
      join(REPO, 'tools', 'audit', '.rejections.json'),
      'utf8',
    );
    expect(after).toContain('99'); // new entry added

    // Re-running with same params: no duplicate
    await runCli(['reject', 'smoke.no-private-methods', 'src/Foo.cs:99']);
    const final = readFileSync(
      join(REPO, 'tools', 'audit', '.rejections.json'),
      'utf8',
    );
    expect(final).toBe(after); // identical — no duplicate entry
  });
});