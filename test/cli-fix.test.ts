/**
 * L3: `regent fix` CLI tests (Phase 3 of fix-mode epic, #60).
 *
 * Spawns the built `dist/cli.js fix` against a per-test tmpdir, asserts
 * exit code + stdout + on-disk file state. Mirrors the pattern of
 * test/cli.test.ts + test/cli-roundtrip.test.ts.
 *
 * Cases:
 *  1. --dry-run does not write to disk and exits 0
 *  2. applies safe-lane edits, writes file, returns exit 0
 *  3. suggested edits surface in `suggested[]` without --all; with
 *     --all they apply
 *  4. --rule <id> restricts to one rule
 *  5. overlapping edits defer with reason='overlap' → exit 1
 *  6. --json emits machine-readable result with `mode` + arrays
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[], cwd: string): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      cwd,
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

let cwd = '';
beforeEach(() => {
  cwd = join(tmpdir(), `regent-cli-fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(cwd, { recursive: true });
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Write a minimal config with inline `rules.detect[]` entries. The
 *  loader reads `.regentrc.js` via cosmiconfig (no extra boilerplate). */
function writeConfig(configBody: string): string {
  const p = join(cwd, '.regentrc.js');
  writeFileSync(p, configBody, 'utf8');
  return p;
}

/** Single-rule replace-fix config. `safe`-lane edit, replaces `match`
 *  with `replacement` whenever `pattern` finds it. */
function safeReplaceConfig(ruleId: string, pattern: string, replacement: string): string {
  // Escape single-quote char inside the JS string literal: each rule's
  // pattern + template field may contain apostrophes in real use, so
  // escape them when building the JS body.
  const patternLiteral = JSON.stringify(pattern);
  const replacementLiteral = JSON.stringify(replacement);
  return `export default {
  rules: {
    detect: [
      {
        id: ${JSON.stringify(ruleId)},
        severity: 'error',
        pattern: ${patternLiteral},
        globs: ['**/*.txt'],
        message: 'match',
        fix: { kind: 'replace', safety: 'safe', title: ${JSON.stringify(ruleId)}, template: ${replacementLiteral} },
      },
    ],
  },
};`;
}

/** Two rules firing on overlapping byte ranges on the same file
 *  content. Their match spans intersect → the engine defers the
 *  later-registered edit with reason='overlap'. */
function overlappingConfig(ruleA: string, ruleB: string): string {
  return `export default {
  rules: {
    detect: [
      {
        id: ${JSON.stringify(ruleA)},
        severity: 'error',
        pattern: 'ab\\.',
        globs: ['**/*.txt'],
        message: 'match a',
        fix: { kind: 'replace', safety: 'safe', title: ${JSON.stringify(ruleA)}, template: 'XXX' },
      },
      {
        id: ${JSON.stringify(ruleB)},
        severity: 'error',
        pattern: 'bcd',
        globs: ['**/*.txt'],
        message: 'match b',
        fix: { kind: 'replace', safety: 'safe', title: ${JSON.stringify(ruleB)}, template: 'YYY' },
      },
    ],
  },
};`;
}

/** A second rule (different id, non-overlapping patterns) so test 4
 *  can verify `--rule` restricts to a single rule. */
function twoRulesConfig(ruleA: string, ruleB: string): string {
  return `export default {
  rules: {
    detect: [
      {
        id: ${JSON.stringify(ruleA)},
        severity: 'error',
        pattern: 'hello',
        globs: ['**/*.txt'],
        message: 'a',
        fix: { kind: 'replace', safety: 'safe', title: ${JSON.stringify(ruleA)}, template: 'HELLO' },
      },
      {
        id: ${JSON.stringify(ruleB)},
        severity: 'error',
        pattern: 'world',
        globs: ['**/*.txt'],
        message: 'b',
        fix: { kind: 'replace', safety: 'safe', title: ${JSON.stringify(ruleB)}, template: 'WORLD' },
      },
    ],
  },
};`;
}

describe('regent fix CLI', () => {
  it('1. --dry-run does not write to disk and exits 0', async () => {
    writeConfig(safeReplaceConfig('cli-fix.dryrun', 'TARGET', 'REPLACED'));
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'hello TARGET world\n', 'utf8');

    const r = await runCli(['fix', '--dry-run', '--yes', '--json'], cwd);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"mode": "dry-run"');
    expect(r.stdout).toContain('"applied"');
    // File unchanged on disk.
    expect(readFileSync(file, 'utf8')).toBe('hello TARGET world\n');
  });

  it('2. applies safe-lane edits, writes file, returns exit 0', async () => {
    writeConfig(safeReplaceConfig('cli-fix.safe', 'TARGET', 'REPLACED'));
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'hello TARGET world\n', 'utf8');

    const r = await runCli(['fix', '--yes'], cwd);
    expect(r.code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('hello REPLACED world\n');
    expect(r.stdout).toContain('Applied:');
    expect(r.stdout).toContain('1 edit');
  });

  it('3a. suggested edits without --all surface in `suggested[]`', async () => {
    writeConfig(
      `export default {
  rules: {
    detect: [
      {
        id: 'cli-fix.suggested',
        severity: 'error',
        pattern: 'TARGET',
        globs: ['**/*.txt'],
        message: 'suggest',
        fix: { kind: 'replace', safety: 'suggested', title: 'cli-fix.suggested', template: 'X' },
      },
    ],
  },
};`,
    );
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'hello TARGET world\n', 'utf8');

    const r = await runCli(['fix', '--yes', '--json'], cwd);
    expect(r.code).toBe(0);

    const json = JSON.parse(r.stdout);
    expect(json.applied).toEqual([]);
    expect(json.suggested).toHaveLength(1);
    expect(json.suggested[0]!.title).toBe('cli-fix.suggested');
    // File is unchanged (suggested is not auto-applied in safe lane).
    expect(readFileSync(file, 'utf8')).toBe('hello TARGET world\n');
  });

  it('3b. suggested edits with --all apply', async () => {
    writeConfig(
      `export default {
  rules: {
    detect: [
      {
        id: 'cli-fix.suggested-all',
        severity: 'error',
        pattern: 'TARGET',
        globs: ['**/*.txt'],
        message: 'suggest',
        fix: { kind: 'replace', safety: 'suggested', title: 'cli-fix.suggested-all', template: 'X' },
      },
    ],
  },
};`,
    );
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'hello TARGET world\n', 'utf8');

    const r = await runCli(['fix', '--all', '--yes', '--json'], cwd);
    expect(r.code).toBe(0);

    const json = JSON.parse(r.stdout);
    expect(json.applied).toHaveLength(1);
    expect(json.suggested).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('hello X world\n');
  });

  it('4. --rule <id> restricts to one rule', async () => {
    writeConfig(twoRulesConfig('cli-fix.rule-a', 'cli-fix.rule-b'));
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'hello world\n', 'utf8');

    // Restrict to rule-a only — 'world' must remain 'world' on disk.
    const r = await runCli(
      ['fix', '--yes', '--rule', 'cli-fix.rule-a', '--json'],
      cwd,
    );
    expect(r.code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('HELLO world\n');

    const json = JSON.parse(r.stdout);
    const appliedIds = json.applied.map((a: { ruleId: string }) => a.ruleId);
    expect(appliedIds).toContain('cli-fix.rule-a');
    expect(appliedIds).not.toContain('cli-fix.rule-b');
  });

  it('5. overlapping edits defer → exit 1 with overlap reason', async () => {
    writeConfig(overlappingConfig('cli-fix.overlap-a', 'cli-fix.overlap-b'));
    // 'abcdefg' lays out byte ranges:
    //   pattern `ab.` matches 'abc' at [0..3]
    //   pattern `bcd` matches 'bcd' at [1..4]
    // Their spans [0..3] and [1..4] overlap on bytes 1..3.
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'abcdefg\n', 'utf8');

    const r = await runCli(['fix', '--yes', '--json'], cwd);
    expect(r.code).toBe(1);

    const json = JSON.parse(r.stdout);
    expect(json.applied).toHaveLength(1);
    expect(json.applied[0]!.ruleId).toBe('cli-fix.overlap-a');
    expect(json.deferred.some(
      (d: { reason: string; ruleId: string }) =>
        d.reason === 'overlap' && d.ruleId === 'cli-fix.overlap-b',
    )).toBe(true);
    // The first-registered edit wins on the byte span; engine collapses
    // 'abc' → 'XXX' on disk.
    expect(readFileSync(file, 'utf8')).toBe('XXXdefg\n');
  });

  it('6. --json output shape: cwd, mode, applied, changedFiles, deferred, suggested', async () => {
    writeConfig(safeReplaceConfig('cli-fix.json', 'X', 'Y'));
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'one X two\n', 'utf8');

    const r = await runCli(['fix', '--yes', '--json'], cwd);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^\{/);

    const json = JSON.parse(r.stdout);
    expect(json.cwd).toBe(cwd);
    expect(json.mode).toBe('apply');
    expect(Array.isArray(json.applied)).toBe(true);
    expect(Array.isArray(json.deferred)).toBe(true);
    expect(Array.isArray(json.suggested)).toBe(true);
    expect(Array.isArray(json.changedFiles)).toBe(true);
    expect(typeof json.unifiedDiff).toBe('string');
    expect(json.applied[0]).toMatchObject({
      ruleId: 'cli-fix.json',
      before: 'X',
      after: 'Y',
    });
  });

  it('--yes with non-TTY stdin is well-defined (CI smoke)', async () => {
    writeConfig(safeReplaceConfig('cli-fix.ci', 'X', 'Y'));
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'A X B\n', 'utf8');

    // Spawn without a TTY: stdin is piped (default). The non-TTY
    // branch is bypassed by --yes, which should make the run succeed.
    const r = await runCli(['fix', '--yes'], cwd);
    expect(r.code).toBe(0);
    // The first match is replaced with the template. Subsequent
    // matches on the same line are not iterated by the runner
    // (one finding per matching line, not per occurrence).
    expect(readFileSync(file, 'utf8')).toBe('A Y B\n');
  });
});
