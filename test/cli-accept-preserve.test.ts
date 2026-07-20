/**
 * L3: `regent accept` must not clobber other config sections (regression
 * for #9), and `--scope` must actually target config.ts.
 *
 * The old `parseConfigText`/`writeConfigFile` round-trip re-emitted the
 * whole module from a regex scrape that only understood `accept`, so
 * `disable`/`override`/`detect` were silently dropped on write. The
 * surgical upsert must leave every other section intact.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = join(tmpdir(), `regent-accept-preserve-${Date.now()}`);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');
const CONFIG = join(REPO, 'tools', 'audit', 'config.ts');

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO,
      env: { ...process.env, NO_COLOR: '1' },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c) => out.push(c));
    proc.stderr.on('data', (c) => err.push(c));
    proc.on('error', reject);
    proc.on('close', (code) =>
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      }),
    );
  });
}

beforeAll(() => {
  mkdirSync(join(REPO, 'tools', 'audit'), { recursive: true });
  // config.ts has disable + override but NO accept array yet — the
  // hardest case for the old full-reemit path.
  writeFileSync(
    CONFIG,
    `import { defineConfig } from '@dot-stbl/regent';

export default defineConfig({
  rules: {
    disable: ['keep.disabled'],
    override: { 'keep.overridden': { severity: 'warning' } },
  },
});
`,
  );
});

afterAll(() => {
  rmSync(REPO, { recursive: true, force: true });
});

describe('regent accept preserves other config sections', () => {
  it('--scope adds the entry to config.ts without dropping disable/override', async () => {
    const r = await runCli([
      'accept', 'new.rule', 'src/**', '--reason', 'tracked in TICKET-1', '--scope',
    ]);
    expect(r.code).toBe(0);

    const content = readFileSync(CONFIG, 'utf8');
    // new accept entry present
    expect(content).toContain('new.rule');
    expect(content).toContain('tracked in TICKET-1');
    // pre-existing sections survived (the #9 bug dropped these)
    expect(content).toContain('keep.disabled');
    expect(content).toContain('keep.overridden');
  });

  it('a second accept accumulates without dropping the first or other sections', async () => {
    const r = await runCli([
      'accept', 'second.rule', 'lib/**', '--reason', 'tracked in TICKET-2', '--scope',
    ]);
    expect(r.code).toBe(0);

    const content = readFileSync(CONFIG, 'utf8');
    expect(content).toContain('new.rule');
    expect(content).toContain('second.rule');
    expect(content).toContain('keep.disabled');
    expect(content).toContain('keep.overridden');
  });
});
