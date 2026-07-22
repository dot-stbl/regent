/**
 * L0: `runSpecDetect` / `runSpecFix` / `runDelegates` / `runFormatFixes`
 * (#34b). Covers the `safeSpawn` + `normalize` integration with
 * real argv (no mocked child_process — the test runner spawns the
 * commands and the test process owns the timing).
 *
 * Tests use the host's `node` binary and `node -e '<script>'` for
 * inline scripts — no temp-file dance, deterministic per-call
 * exit code + stdout capture via process.execPath.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';

import { defineDelegate } from '../../src/kinds/delegate.js';
import { defineFormat } from '../../src/kinds/format.js';
import {
  runDelegates,
  runFormatFixes,
  runSpecDetect,
  runSpecFix,
  SafetyError,
  safeSpawn,
} from '../../src/runner/delegate.js';

const HOST_NODE = process.execPath;

/** Run a node -e '<script>' and return argv. */
function nodeArgv(script: string, ...extra: string[]): readonly string[] {
  return [HOST_NODE, '-e', script, ...extra];
}

describe('safeSpawn', () => {
  it('captures exit code + stdout + stderr + argv', () => {
    const proc = safeSpawn(nodeArgv(`process.stdout.write('hello'); process.exit(0);`));
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.trim()).toBe('hello');
    expect(proc.argv[0]).toBe(HOST_NODE);
    expect(proc.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures non-zero exit codes', () => {
    const proc = safeSpawn(nodeArgv(`process.exit(7);`));
    expect(proc.exitCode).toBe(7);
  });

  it('throws SafetyError on `vite` (denylist first-token)', () => {
    expect(() => safeSpawn(['vite'])).toThrow(SafetyError);
  });

  it('throws SafetyError on `--watch` flag (blocklist)', () => {
    expect(() => safeSpawn(['tsc', '--watch'])).toThrow(SafetyError);
  });

  it('captures the argv verbatim for error reporting', () => {
    const argv = nodeArgv(`process.exit(0);`);
    const proc = safeSpawn(argv);
    expect(proc.argv).toEqual(argv);
    expect(proc.command).toBe(HOST_NODE);
  });
});

describe('runSpecDetect', () => {
  it('runs a successful detect and feeds the captured proc to `normalize`', () => {
    const spec = defineDelegate({
      id: 'shell.success',
      severity: 'warning',
      params: z.object({}),
      detect: () => nodeArgv(`process.stdout.write('[]'); process.exit(0);`),
      normalize: (proc) => {
        if (proc.exitCode === 0) return [];
        return [
          {
            ruleId: 'shell.success',
            severity: 'warning',
            path: '/x.ts',
            match: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, matchText: '', groups: [] },
            context: { startLine: 0, endLine: 0, lines: [] },
            message: 'unexpected exit',
            source: 'shell.success',
            status: 'violation',
          },
        ];
      },
    });
    expect(runSpecDetect(spec, undefined)).toEqual([]);
  });

  it('returns the normalizer findings when the tool exits non-zero', () => {
    const spec = defineDelegate({
      id: 'shell.findings',
      severity: 'error',
      params: z.object({}),
      detect: () => nodeArgv(`process.stdout.write('one issue'); process.exit(1);`),
      normalize: (proc) => [{
        ruleId: 'shell.findings',
        severity: 'error',
        path: '/x.ts',
        match: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, matchText: '', groups: [] },
        context: { startLine: 0, endLine: 0, lines: [] },
        message: proc.stdout.trim(),
        source: 'shell.findings',
        status: 'violation',
      }],
    });
    const findings = runSpecDetect(spec, undefined);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('shell.findings');
    expect(findings[0]?.message).toBe('one issue');
  });

  it('synthesises a workspace-level finding when the tool crashes silently', () => {
    const spec = defineDelegate({
      id: 'shell.silent-crash',
      severity: 'warning',
      params: z.object({}),
      detect: () => nodeArgv(`process.exit(2);`), // no stdout, no stderr
      normalize: () => [],
    });
    const findings = runSpecDetect(spec, undefined);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toMatch(/exited with code 2/);
    expect(findings[0]?.message).toMatch(/no parseable output/);
  });

  it('synthesises a finding when `safeSpawn` rejects the argv', () => {
    const spec = defineDelegate({
      id: 'spec.safety-reject',
      severity: 'warning',
      params: z.object({}),
      detect: () => ['vite'],
      normalize: () => [],
    });
    const findings = runSpecDetect(spec, undefined);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/refused/);
    expect(findings[0]?.message).toMatch(/argv\[0\] 'vite'/);
  });

  it('synthesises a finding when `normalize` throws', () => {
    const spec = defineDelegate({
      id: 'spec.normalize-throws',
      severity: 'warning',
      params: z.object({}),
      detect: () => nodeArgv(`process.stdout.write('oops'); process.exit(0);`),
      normalize: () => { throw new Error('JSON.parse: unexpected token'); },
    });
    const findings = runSpecDetect(spec, undefined);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/normalize threw/);
    expect(findings[0]?.message).toMatch(/JSON\.parse: unexpected token/);
  });

  it('threads the configured value into a function-form `detect`', () => {
    // Inline the configured value into the script so the standalone
    // `node -e '<script>'` process can read it (no in-scope `p`).
    const spec = defineDelegate({
      id: 'spec.threading',
      severity: 'warning',
      params: z.object({ name: z.string().default('default') }),
      detect: (p) =>
        nodeArgv(`process.stdout.write(${JSON.stringify(p.name)});`),
      normalize: (proc) => [{
        ruleId: 'spec.threading',
        severity: 'warning',
        path: proc.stdout.trim(),
        match: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, matchText: '', groups: [] },
        context: { startLine: 0, endLine: 0, lines: [] },
        message: proc.stdout.trim(),
        source: 'spec.threading',
        status: 'violation',
      }],
    });
    const findings = runSpecDetect(spec, { name: 'tuned' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe('tuned');
  });

  it('synthesises a finding when `params.parse` throws on a malformed config value', () => {
    const spec = defineDelegate({
      id: 'spec.parse-throws',
      severity: 'warning',
      params: z.object({ max: z.number().int() }),
      detect: () => nodeArgv(`process.exit(0);`),
      normalize: () => [],
    });
    const findings = runSpecDetect(spec, { max: 'not-a-number' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/config validation failed/);
  });

  it('runs a no-params spec (detects without a zod schema)', () => {
    // Static-argv inline spec — no zod schema, no `params` field.
    // The runner skips `params.parse` and runs the argv directly.
    const spec = defineDelegate({
      id: 'spec.no-schema',
      severity: 'warning',
      params: undefined as unknown as z.ZodTypeAny,
      detect: () => nodeArgv(`process.exit(0);`),
      normalize: () => [],
    });
    expect(runSpecDetect(spec, undefined)).toEqual([]);
  });
});

describe('runSpecFix', () => {
  it('invokes `fix` and returns empty findings on success', () => {
    const spec = defineFormat({
      id: 'fmt.fix-success',
      severity: 'warning',
      params: z.object({}),
      detect: () => nodeArgv(`process.exit(0);`),
      fix: () => nodeArgv(`process.exit(0);`),
      normalize: () => [],
    });
    expect(runSpecFix(spec, undefined)).toEqual([]);
  });

  it('returns empty for detect-only format specs (no `fix` field)', () => {
    const spec = defineFormat({
      id: 'fmt.detect-only',
      severity: 'warning',
      params: z.object({}),
      detect: () => nodeArgv(`process.exit(0);`),
      normalize: () => [],
    });
    expect(runSpecFix(spec, undefined)).toEqual([]);
  });

  it('synthesises a finding when `fix` violates the safety blocklist', () => {
    const spec = defineFormat({
      id: 'fmt.fix-unsafe',
      severity: 'warning',
      params: z.object({}),
      detect: () => nodeArgv(`process.exit(0);`),
      fix: () => ['vite', '--port=3000'],
      normalize: () => [],
    });
    const findings = runSpecFix(spec, undefined);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/fix refused/);
    expect(findings[0]?.message).toMatch(/argv\[0\] 'vite'/);
  });
});

describe('runDelegates / runFormatFixes', () => {
  let tmpDirForTest: string;
  beforeAll(() => {
    tmpDirForTest = join(tmpdir(), `regent-delegate-runner-${Date.now()}`);
    mkdirSync(tmpDirForTest, { recursive: true });
  });
  afterAll(() => {
    rmSync(tmpDirForTest, { recursive: true, force: true });
  });

  it('runDelegates concatenates findings in spec order', async () => {
    const specs = [
      defineDelegate({
        id: 'a',
        severity: 'warning',
        params: z.object({}),
        detect: () => nodeArgv(`process.stdout.write('a-out'); process.exit(1);`),
        normalize: (proc) => [{
          ruleId: 'a', severity: 'warning', path: proc.stdout.trim(),
          match: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, matchText: '', groups: [] },
          context: { startLine: 0, endLine: 0, lines: [] }, message: proc.stdout.trim(),
          source: 'a', status: 'violation',
        }],
      }),
      defineDelegate({
        id: 'b',
        severity: 'warning',
        params: z.object({}),
        detect: () => nodeArgv(`process.stdout.write('b-out'); process.exit(1);`),
        normalize: (proc) => [{
          ruleId: 'b', severity: 'warning', path: proc.stdout.trim(),
          match: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, matchText: '', groups: [] },
          context: { startLine: 0, endLine: 0, lines: [] }, message: proc.stdout.trim(),
          source: 'b', status: 'violation',
        }],
      }),
    ];
    const findings = await runDelegates(specs, {});
    expect(findings).toHaveLength(2);
    expect(findings[0]?.ruleId).toBe('a');
    expect(findings[1]?.ruleId).toBe('b');
  });

  it('runFormatFixes skips specs without `fix`', async () => {
    const detectOnly = defineFormat({
      id: 'fmt.skip',
      severity: 'warning',
      params: z.object({}),
      detect: () => nodeArgv(`process.exit(0);`),
      normalize: () => [],
    });
    expect(await runFormatFixes([detectOnly], {})).toEqual([]);
  });

  it('runDelegates with empty specs returns empty findings', async () => {
    expect(await runDelegates([], {})).toEqual([]);
  });
});
