/**
 * L3: llm.txt loader + CLI subcommand — verify the LLM-friendly skill
 * documentation is shipped, loadable, and exposed via `regent llm` /
 * `regent --llm`.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadLlmText } from '../src/llm.js';

const REPO = join(tmpdir(), `regent-llm-smoke-${Date.now()}`);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

beforeAll(() => {
  mkdirSync(REPO, { recursive: true });
});

afterAll(() => {
  rmSync(REPO, { recursive: true, force: true });
});

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

describe('llm.txt loader', () => {
  it('loadLlmText returns non-empty content', () => {
    const content = loadLlmText();
    expect(content.length).toBeGreaterThan(500);
  });

  it('content contains the skill doc header', () => {
    const content = loadLlmText();
    expect(content).toContain('regent — agent skill');
  });

  it('content covers all major sections', () => {
    const content = loadLlmText();
    const required = [
      'When to use',
      'Invocation',
      'Writing a rule',
      'Configuration',
      'Tri-state review',
      'Layer merge',
      'Output formats',
      'Anti-patterns',
    ];
    for (const section of required) {
      expect(content, `missing section: ${section}`).toContain(section);
    }
  });

  it('content includes RE2 syntax cheatsheet (no backrefs)', () => {
    const content = loadLlmText();
    expect(content).toContain('NO backreferences');
    expect(content).toContain('NO lookahead');
  });
});

describe('regent llm CLI', () => {
  it('build artefact exists for CLI tests', () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it('regent llm prints skill doc and exits 0', async () => {
    const r = await runCli(['llm']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('regent — agent skill');
    expect(r.stdout.length).toBeGreaterThan(500);
  });

  it('regent --llm flag prints skill doc and exits 0', async () => {
    const r = await runCli(['--llm']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('regent — agent skill');
  });
});