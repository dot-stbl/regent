import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runExplain, type ExplainFormat } from '../src/cli/explain.js';

const ROOT = join(tmpdir(), `regent-explain-${Date.now()}`);
const EMPTY_GLOBALS = join(ROOT, 'globals');
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');
const ZOD_URL = pathToFileURL(join(import.meta.dirname, '..', 'node_modules', 'zod', 'index.js')).href;
const originalGlobalRulesPath = process.env['STBL_REGENT_GLOBAL_RULES_PATH'];

beforeAll(() => {
  mkdirSync(EMPTY_GLOBALS, { recursive: true });
  process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = EMPTY_GLOBALS;
  writeFileSync(join(ROOT, 'Known.cs'), 'alpha\n  bad();\nomega\n', 'utf8');
  writeFileSync(join(ROOT, '.regentrc.js'), `import { z } from ${JSON.stringify(ZOD_URL)};

export default {
  rules: {
    detect: [
      {
        id: 'fixture.no-bad',
        severity: 'error',
        pattern: 'bad\\\\(\\\\)',
        globs: ['**/*.cs'],
        message: 'bad() is forbidden',
        description: 'Use the supported call instead.',
        references: ['https://example.test/rules/no-bad'],
        source: 'rules.md#no-bad',
        fix: {
          kind: 'replace',
          safety: 'safe',
          title: 'replace bad() with good()',
          template: 'good()',
        },
      },
      {
        id: 'fixture.max-line-length',
        severity: 'warning',
        params: z.object({ max: z.number().default(120) }),
        pattern: (params) => '^.{' + String(params.max + 1) + ',}$',
        globs: ['**/*.cs'],
        message: (params) => 'line exceeds ' + String(params.max) + ' chars',
        rationale: 'Keep source lines readable.',
      },
    ],
  },
};
`, 'utf8');
});

afterAll(() => {
  if (originalGlobalRulesPath === undefined) {
    delete process.env['STBL_REGENT_GLOBAL_RULES_PATH'];
  } else {
    process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = originalGlobalRulesPath;
  }
  rmSync(ROOT, { recursive: true, force: true });
});

async function invoke(
  target: string,
  format: ExplainFormat = 'text',
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await runExplain(target, { cwd: ROOT, format });
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

function runCli(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const processHandle = spawn(process.execPath, [CLI, ...args], {
      cwd: import.meta.dirname,
      env: {
        ...process.env,
        NO_COLOR: '1',
        NODE_NO_WARNINGS: '1',
        STBL_REGENT_GLOBAL_RULES_PATH: EMPTY_GLOBALS,
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    processHandle.stdout.on('data', (chunk) => stdout.push(chunk));
    processHandle.stderr.on('data', (chunk) => stderr.push(chunk));
    processHandle.on('error', rejectPromise);
    processHandle.on('close', (code) => resolvePromise({
      code: code ?? 0,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

describe('runExplain rule id mode', () => {
  it('renders a known rule with examples, remediation, and references', async () => {
    const result = await invoke('fixture.no-bad');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('description: Use the supported call instead.');
    expect(result.stdout).toContain('message: bad() is forbidden');
    expect(result.stdout).toContain('example match:');
    expect(result.stdout).toContain('replace bad() with good()');
    expect(result.stdout).toContain('https://example.test/rules/no-bad');
    expect(result.stderr).toBe('');
  });

  it('returns exit code 2 for an unknown rule', async () => {
    const result = await invoke('nonexistent');

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("no rule with id 'nonexistent'");
  });

  it('shows the configure sample for a parameterised rule', async () => {
    const result = await invoke('fixture.max-line-length');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('rules.configure:');
    expect(result.stdout).toContain("'fixture.max-line-length': {\"max\":120}");
  });

  it('emits structured JSON', async () => {
    const result = await invoke('fixture.no-bad', 'json');
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.code).toBe(0);
    expect(output['mode']).toBe('rule');
  });
});

describe('runExplain finding locator mode', () => {
  it('renders the finding snippet and guidance', async () => {
    const result = await invoke('Known.cs:2:3');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('fixture.no-bad');
    expect(result.stdout).toContain('2 │   bad();');
    expect(result.stdout).toContain('Description: Use the supported call instead.');
    expect(result.stdout).toContain('Remediation: replace bad() with good()');
    expect(result.stdout).toContain("Suppress: add 'fixture.no-bad' to rules.disable");
  });

  it('reports a missing locator with the refresh hint', async () => {
    const result = await invoke('Known.cs:2:4');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'no finding at Known.cs:2:4 in last run; run `regent check` to refresh\n',
    );
  });
});

describe('regent explain CLI', () => {
  it('runs end to end through the built CLI', async () => {
    const result = await runCli(['explain', 'fixture.no-bad', '--cwd', ROOT]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('=== fixture.no-bad ===');
    expect(result.stdout).toContain('example fix:');
    expect(result.stderr).toBe('');
  });
});
