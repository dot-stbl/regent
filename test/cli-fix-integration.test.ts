/**
 * L3: end-to-end integration tests for `regent fix` (Phase 8 of the
 * fix-mode epic, #65).
 *
 * Distinct from:
 *  - `test/cli-fix.test.ts` (P3 #60) — CLI mechanics with inline
 *    `.regentrc.js` configs and synthetic fixtures.
 *  - `test/fix-snapshots.test.ts` (P6 #63) — golden-output snapshots
 *    of `applyFixes` driven by `rules.ts` modules under `test/__fixtures__/`.
 *
 * These tests prove the whole pipeline works together: shipped example
 * fixtures (`examples/<lang>/__fixtures__/<rule>/{bad,good}.{ext}`) +
 * shipped example rule files (`examples/<lang>/<rule>.lint.ts`) +
 * the built `dist/cli.js fix` invocation. P8's deliverables.
 *
 * Fixture-loading strategy: the example `.lint.ts` files import the
 * package via the bare specifier `import { defineRule } from
 * '@dot-stbl/regent'`. Real users have that resolved by their
 * npm install; tests fake it by symlinking the regent repo at
 * `<tmpdir>/node_modules/@dot-stbl/regent`. The example rule file
 * is then copied into `<tmpdir>/tools/audit/rules/<ruleId>.lint.ts`
 * so the loader's repo-local discovery picks it up — same code
 * path real users hit when they run `regent example copy`.
 *
 * Each test calls into the BUILT CLI (`dist/cli.js`) — never the
 * library directly — so the test verifies the whole stack including
 * the loader's glob discovery, the cosmiconfig config layer, the
 * fix engine, and the CLI output formatting.
 *
 * The 8 cases below match the AC checklist in issue #65:
 *  1. configure-await: bad.cs → `regent fix --yes` mutates file in place
 *  2. configure-await: round-trip idempotency
 *  3. brace-style: bad.cs → `regent fix --unsafe --yes` mutates file
 *  4. suggested-lane without --all: file unchanged, suggested[] populated
 *  5. suggested-lane with --all: file updated, applied[] populated
 *  6. dry-run: file unchanged on disk, applied[] populated in JSON
 *  7. JSON schema conformance (validate against fix-v1.json)
 *  8. negative: malformed config → non-zero exit, descriptive error
 *
 * Some shipped fixtures carry a `good.cs` that the auto-fix does
 * NOT produce byte-for-byte — the example rule's fix template only
 * deletes the matched substring; the `good.cs` represents the
 * human-cleaned-up shape. Per the rule comment in
 * `csharp.async.configure-await.lint.ts`:
 *
 *   "The post-fix file has an empty-statement `;` where the call
 *   used to sit — a single empty statement is legal C# but
 *   stylistically noisy; the good fixture demonstrates the
 *   chain-on-one-line shape that human editors typically aim for."
 *
 * So this suite deliberately skips byte-for-byte comparison and
 * falls back to: `applied.length >= 1` + the applied entry's
 * `before` substring matches the known violation + on-disk content
 * != original. Documented in the PR body.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateFixV1, type FixV1Document } from '../src/reporter/fix-schema.js';

const REPO_ROOT = join(import.meta.dirname, '..');
const CLI = join(REPO_ROOT, 'dist', 'cli.js');
const SCHEMA_PATH = join(REPO_ROOT, 'assets', 'llm', 'schema', 'fix-v1.json');
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>;

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
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk as Buffer));
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk as Buffer));
    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

let cwd = '';

beforeEach(() => {
  cwd = mkdtempSync(
    join(tmpdir(), `regent-cli-fix-int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  );

  // Symlink <tmpdir>/node_modules/@dot-stbl/regent -> <repo>.
  // The example `.lint.ts` files import the package via the bare
  // specifier `import { defineRule } from '@dot-stbl/regent'`. Real
  // users resolve that through npm install; in the test environment
  // we mock the resolution by linking the regent repo itself, which
  // is the same effect (the loaded module re-exports `defineRule`).
  const dotStbl = join(cwd, 'node_modules', '@dot-stbl');
  mkdirSync(dotStbl, { recursive: true });
  symlinkSync(REPO_ROOT, join(dotStbl, 'regent'), 'junction');
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/**
 * Copy a shipped example `.lint.ts` rule file into the tmpdir under
 * `tools/audit/rules/` so the loader's repo-local discovery path picks
 * it up. Mirrors what `regent example copy` does for end users.
 */
function installExampleRule(language: string, ruleId: string): string {
  const src = join(REPO_ROOT, 'examples', language, `${ruleId}.lint.ts`);
  const target = join(cwd, 'tools', 'audit', 'rules', `${ruleId}.lint.ts`);
  mkdirSync(join(cwd, 'tools', 'audit', 'rules'), { recursive: true });
  copyFileSync(src, target);
  return target;
}

/** Copy a fixture's `bad.<ext>` into `<cwd>/bad.<ext>`. */
function copyBadFixture(language: string, ruleId: string, ext = 'cs'): string {
  const src = join(REPO_ROOT, 'examples', language, '__fixtures__', ruleId, `bad.${ext}`);
  const dst = join(cwd, `bad.${ext}`);
  copyFileSync(src, dst);
  return dst;
}

/** Copy a throwaway integration fixture rule (test/__fixtures__/integration/...). */
function installIntegrationFixtureRule(fixtureName: string): string {
  const src = join(REPO_ROOT, 'test', '__fixtures__', 'integration', fixtureName, 'suggested.lint.ts');
  const target = join(cwd, 'tools', 'audit', 'rules', 'suggested.lint.ts');
  mkdirSync(join(cwd, 'tools', 'audit', 'rules'), { recursive: true });
  copyFileSync(src, target);
  return target;
}

describe('cli-fix-integration — end-to-end regent fix pipeline (P8, #65)', () => {
  it('1. configure-await fixture: bad.cs → regent fix --yes mutates file in place', async () => {
    const badPath = copyBadFixture('csharp', 'csharp.async.configure-await');
    const rulePath = installExampleRule('csharp', 'csharp.async.configure-await');

    const before = readFileSync(badPath, 'utf8');
    expect(before).toContain('.ConfigureAwait(false)');

    const result = await runCli(['fix', '--yes', '--format', 'json'], cwd);

    expect(result.code).toBe(0);
    expect(existsSync(rulePath)).toBe(true);

    const after = readFileSync(badPath, 'utf8');
    expect(after).not.toBe(before);
    expect(after).not.toContain('.ConfigureAwait(false)');

    const doc = JSON.parse(result.stdout) as FixV1Document;
    expect(doc.applied.length).toBeGreaterThanOrEqual(1);
    const applied = doc.applied.find((a) => a.ruleId === 'csharp.async.configure-await');
    expect(applied).toBeDefined();
    expect(applied!.before).toContain('.ConfigureAwait');
    expect(applied!.after).toBe('');
  });

  it('2. configure-await fixture: round-trip — second regent fix produces zero edits', async () => {
    copyBadFixture('csharp', 'csharp.async.configure-await');
    installExampleRule('csharp', 'csharp.async.configure-await');

    const first = await runCli(['fix', '--yes', '--format', 'json'], cwd);
    expect(first.code).toBe(0);

    const afterFirst = readFileSync(join(cwd, 'bad.cs'), 'utf8');

    const second = await runCli(['fix', '--yes', '--format', 'json'], cwd);
    expect(second.code).toBe(0);

    const afterSecond = readFileSync(join(cwd, 'bad.cs'), 'utf8');
    expect(afterSecond).toBe(afterFirst);

    const doc = JSON.parse(second.stdout) as FixV1Document;
    expect(doc.applied).toEqual([]);
    expect(doc.suggested).toEqual([]);
    expect(doc.deferred).toEqual([]);
  });

  it('3. brace-style fixture: bad.cs → regent fix --unsafe --yes (function-form, P7 #64)', async () => {
    const badPath = copyBadFixture('csharp', 'csharp.exceptions.brace-style');
    installExampleRule('csharp', 'csharp.exceptions.brace-style');

    const before = readFileSync(badPath, 'utf8');
    expect(before).toMatch(/[^\s}]\s+}$/m);

    const result = await runCli(['fix', '--unsafe', '--yes', '--format', 'json'], cwd);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      'note: --unsafe enables function-form fixes; review the diff before committing',
    );

    const after = readFileSync(badPath, 'utf8');
    expect(after).not.toBe(before);

    const doc = JSON.parse(result.stdout) as FixV1Document;
    expect(doc.applied.length).toBeGreaterThanOrEqual(1);
    const applied = doc.applied.find((a) => a.ruleId === 'csharp.exceptions.brace-style');
    expect(applied).toBeDefined();
    expect(applied!.before).toContain('}');
  });

  it('4. suggested-lane without --all: file unchanged, suggested[] populated', async () => {
    installIntegrationFixtureRule('suggested-rule');
    const target = join(cwd, 'sample.txt');
    const originalContent = 'one TARGET_SUGGESTED two\n';
    writeFileSync(target, originalContent, 'utf8');

    const result = await runCli(['fix', '--yes', '--format', 'json'], cwd);
    expect(result.code).toBe(0);

    expect(readFileSync(target, 'utf8')).toBe(originalContent);

    const doc = JSON.parse(result.stdout) as FixV1Document;
    expect(doc.applied).toEqual([]);
    expect(doc.suggested.length).toBeGreaterThanOrEqual(1);
    const suggested = doc.suggested.find(
      (s) => s.ruleId === 'cli-integration.suggested-fixture',
    );
    expect(suggested).toBeDefined();
    expect(suggested!.title).toContain('TARGET_SUGGESTED');
    expect(suggested!.proposedEdit).not.toBeNull();
    expect(suggested!.proposedEdit!.replacement).toBe('');
  });

  it('5. suggested-lane with --all: file updated, applied[] populated', async () => {
    installIntegrationFixtureRule('suggested-rule');
    const target = join(cwd, 'sample.txt');
    const originalContent = 'one TARGET_SUGGESTED two\n';
    writeFileSync(target, originalContent, 'utf8');

    const result = await runCli(['fix', '--unsafe', '--yes', '--format', 'json'], cwd);
    expect(result.code).toBe(0);

    const after = readFileSync(target, 'utf8');
    expect(after).not.toBe(originalContent);
    expect(after).not.toContain('TARGET_SUGGESTED');

    const doc = JSON.parse(result.stdout) as FixV1Document;
    const applied = doc.applied.find(
      (a) => a.ruleId === 'cli-integration.suggested-fixture',
    );
    expect(applied).toBeDefined();
    expect(applied!.before).toBe('TARGET_SUGGESTED');
    expect(applied!.after).toBe('');

    const stillSuggested = doc.suggested.find(
      (s) => s.ruleId === 'cli-integration.suggested-fixture',
    );
    expect(stillSuggested).toBeUndefined();
  });

  it('6. dry-run: file unchanged on disk, applied[] populated in JSON', async () => {
    const badPath = copyBadFixture('csharp', 'csharp.async.configure-await');
    installExampleRule('csharp', 'csharp.async.configure-await');

    const before = readFileSync(badPath, 'utf8');

    const result = await runCli(['fix', '--dry-run', '--yes', '--format', 'json'], cwd);
    expect(result.code).toBe(0);

    expect(readFileSync(badPath, 'utf8')).toBe(before);

    const doc = JSON.parse(result.stdout) as FixV1Document;
    const applied = doc.applied.find((a) => a.ruleId === 'csharp.async.configure-await');
    expect(applied).toBeDefined();
    expect(applied!.before).toContain('.ConfigureAwait');
  });

  it('7. JSON schema conformance: --format json output validates against assets/llm/schema/fix-v1.json', async () => {
    copyBadFixture('csharp', 'csharp.async.configure-await');
    installExampleRule('csharp', 'csharp.async.configure-await');

    const result = await runCli(['fix', '--yes', '--format', 'json'], cwd);
    expect(result.code).toBe(0);

    const doc = JSON.parse(result.stdout) as FixV1Document;
    const validation = validateFixV1(doc, SCHEMA);
    expect(validation.valid, JSON.stringify(
      validation.valid ? null : validation.issues,
      null,
      2,
    )).toBe(true);

    expect(Object.keys(doc).sort()).toEqual(['applied', 'deferred', 'suggested']);
  });

  it('8. negative: malformed config triggers a descriptive non-zero exit', async () => {
    // `safe` + `guidance-only` is a known safety↔kind contradiction
    // (see `validateFixSpec` in src/types.ts). The Zod schema accepts
    // the shape; the loader's `assertFixSafety` rejects it. We use
    // this combination rather than a missing `title` because Zod
    // validation errors are caught and pushed into a project-layer
    // warning (config/index.ts:144) — they do NOT surface as a
    // non-zero CLI exit. The runtime safety↔kind check IS surfaced.
    writeFileSync(
      join(cwd, '.regentrc.js'),
      `export default {
  rules: {
    detect: [
      {
        id: 'cli-integration.bad-safety',
        severity: 'error',
        pattern: 'TARGET',
        globs: ['**/*.txt'],
        message: 'malformed',
        fix: { kind: 'guidance-only', safety: 'safe', title: 'X' },
      },
    ],
  },
};`,
      'utf8',
    );
    writeFileSync(join(cwd, 'a.txt'), 'TARGET\n', 'utf8');

    const result = await runCli(['fix', '--yes'], cwd);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('failed to load rules');
    expect(result.stderr).toContain('fix validation failed');
    expect(result.stderr).toContain('safe fixes must carry a concrete kind');
  });
});