/**
 * L3: llm.txt loader + CLI subcommand — verify the LLM-friendly skill
 * documentation is shipped, loadable, and exposed via `regent llm` /
 * `regent --llm`.
 *
 * v0.2: multi-page layout under assets/llm/. The CLI router returns
 * the index by default and resolves subcommand paths on demand.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadLlmText, loadLlmDoc } from '../src/llm.js';
import { routeLlm } from '../src/llm-router.js';

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

describe('llm.txt loader (v0.2 multi-page)', () => {
  it('loadLlmText returns the index', () => {
    const content = loadLlmText();
    expect(content).toContain('regent');
    expect(content).toContain('agent skill');
  });

  it('loadLlmDoc returns the index when no path is given', () => {
    expect(loadLlmDoc('index.md')).toBe(loadLlmText());
  });

  it('index links to the major subcommands', () => {
    const content = loadLlmText();
    expect(content).toMatch(/regent llm authoring/);
    expect(content).toMatch(/regent llm schema/);
    expect(content).toMatch(/regent llm examples/);
  });
});

describe('llm-router', () => {
  it('routes [] to the index', () => {
    const r = routeLlm([]);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.path).toBe('index.md');
    }
  });

  it('routes [authoring] to authoring/index.md', () => {
    const r = routeLlm(['authoring']);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.path).toBe('authoring/index.md');
    }
  });

  it('routes [authoring, detect] to authoring/detect.md', () => {
    const r = routeLlm(['authoring', 'detect']);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.path).toBe('authoring/detect.md');
      expect(r.content).toContain('Authoring detect rules');
    }
  });

  it('routes [authoring, fix] to authoring/fix.md', () => {
    const r = routeLlm(['authoring', 'fix']);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.path).toBe('authoring/fix.md');
    }
  });

  it('routes [schema, detect] to schema/detect.md', () => {
    const r = routeLlm(['schema', 'detect']);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.path).toBe('schema/detect.md');
      expect(r.content).toContain('Schema — detect rule');
    }
  });

  it('routes [examples, csharp] to examples/csharp/index.md', () => {
    const r = routeLlm(['examples', 'csharp']);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.path).toBe('examples/csharp/index.md');
    }
  });

  it('routes [examples, csharp, no-todo-without-owner] to examples/csharp/<rule>.md', () => {
    const r = routeLlm(['examples', 'csharp', 'no-todo-without-owner']);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.path).toBe('examples/csharp/no-todo-without-owner.md');
    }
  });

  it('returns an error for unknown subcommands', () => {
    const r = routeLlm(['unknown', 'subcommand']);
    expect(r.kind).toBe('error');
  });

  it('returns an error for a missing example', () => {
    const r = routeLlm(['examples', 'csharp', 'does-not-exist']);
    expect(r.kind).toBe('error');
  });
});

describe('regent llm CLI', () => {
  it('build artefact exists for CLI tests', () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it('regent llm (no args) prints the index and exits 0', async () => {
    const r = await runCli(['llm']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('regent');
    expect(r.stdout).toContain('agent skill');
  });

  it('regent llm authoring detect prints the detect guide', async () => {
    const r = await runCli(['llm', 'authoring', 'detect']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Authoring detect rules');
  });

  it('regent llm examples csharp prints the csharp example list', async () => {
    const r = await runCli(['llm', 'examples', 'csharp']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('C# examples');
  });

  it('regent llm on a missing subcommand exits 2', async () => {
    const r = await runCli(['llm', 'completely-unknown']);
    expect(r.code).toBe(2);
  });

  it('regent --llm flag prints the index and exits 0', async () => {
    const r = await runCli(['--llm']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('regent');
  });
});