/**
 * L3: PR annotation — body construction, dedupe, diff filter, gh failure paths.
 */

import { Buffer } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  annotateFindings,
  parsePatchRightLines,
  parsePullFiles,
  type AnnotationCommandRunner,
} from '../src/cli/annotate-pr.js';
import type { Finding } from '../src/types.js';

interface CommandCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin?: string;
}

interface ScriptedRunnerOptions {
  readonly pullSha?: string;
  readonly existingBodies?: string;
  readonly missingGh?: boolean;
  readonly pullFails?: boolean;
  readonly commentsFails?: boolean;
  readonly filesFails?: boolean;
  readonly filesJson?: string;
  readonly postResult?: { code: number; stderr?: string };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  const match = overrides.match ?? {
    startLine: 9,
    startColumn: 4,
    endLine: 9,
    endColumn: 7,
    matchText: 'TODO',
  };
  return {
    ruleId: overrides.ruleId ?? 'csharp.no-todo-without-owner',
    severity: overrides.severity ?? 'error',
    path: overrides.path ?? 'src/foo.cs',
    match,
    context: overrides.context ?? {
      lines: ['    // TODO: refactor'],
      startLine: 7,
      endLine: 11,
    },
    message: overrides.message ?? 'TODO comment must declare an owner.',
    source: overrides.source ?? 'rules/csharp/no-todo-without-owner.md',
    rationale: overrides.rationale ?? 'TODOs are useful only when assigned.',
    status: overrides.status ?? 'violation',
  };
}

/** Default patch puts right-side line 10 in the diff for src/foo.cs. */
function defaultFilesJson(extra: readonly object[] = []): string {
  return JSON.stringify([
    {
      filename: 'src/foo.cs',
      status: 'modified',
      patch: [
        '@@ -7,5 +7,5 @@',
        ' context',
        ' context',
        ' context',
        '-    // old',
        '+    // TODO: refactor',
        ' context',
      ].join('\n'),
    },
    {
      filename: 'src/baz.cs',
      status: 'modified',
      patch: [
        '@@ -7,5 +7,5 @@',
        ' context',
        ' context',
        ' context',
        '-    // old',
        '+    // region',
        ' context',
      ].join('\n'),
    },
    {
      filename: 'src/bar.cs',
      status: 'modified',
      patch: [
        '@@ -7,5 +7,5 @@',
        ' context',
        ' context',
        ' context',
        '-    // old',
        '+    // region',
        ' context',
      ].join('\n'),
    },
    ...extra,
  ]);
}

function makeRunner(options: ScriptedRunnerOptions = {}): {
  runner: AnnotationCommandRunner;
  calls: CommandCall[];
  postedPayloads: Array<Record<string, unknown>>;
} {
  const calls: CommandCall[] = [];
  const postedPayloads: Array<Record<string, unknown>> = [];
  const pullSha = options.pullSha ?? 'abc123';
  const existingBodies = options.existingBodies ?? '';
  const missingGh = options.missingGh ?? false;
  const pullFails = options.pullFails ?? false;
  const commentsFails = options.commentsFails ?? false;
  const filesFails = options.filesFails ?? false;
  const filesJson = options.filesJson ?? defaultFilesJson();
  const postResult = options.postResult ?? { code: 0 };
  const runner: AnnotationCommandRunner = async (command, args, _cwd, commandOptions) => {
    calls.push({ command, args, stdin: commandOptions?.stdin });
    if (command === 'git') {
      return { code: 0, stdout: 'true', stderr: '' };
    }
    if (command === 'gh' && missingGh) {
      return { code: 2, stdout: '', stderr: 'spawn gh ENOENT', missing: true };
    }
    if (command === 'gh' && args[0] === 'api') {
      const endpoint = args[1] ?? '';
      if (endpoint.includes('/pulls/') && endpoint.endsWith('/files')) {
        if (filesFails) {
          return { code: 1, stdout: '', stderr: 'could not list files' };
        }
        return { code: 0, stdout: filesJson, stderr: '' };
      }
      if (
        endpoint.includes('/pulls/')
        && endpoint.endsWith('/comments')
        && args.includes('--method')
        && args[args.indexOf('--method') + 1] === 'POST'
      ) {
        const raw = commandOptions?.stdin ?? '';
        try {
          postedPayloads.push(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          postedPayloads.push({ raw });
        }
        return { code: postResult.code, stdout: '', stderr: postResult.stderr ?? '' };
      }
      if (endpoint.includes('/pulls/') && endpoint.endsWith('/comments')) {
        if (commentsFails) {
          return { code: 1, stdout: '', stderr: 'gh api failed' };
        }
        return { code: 0, stdout: existingBodies, stderr: '' };
      }
      if (endpoint.includes('/pulls/') && !endpoint.endsWith('/comments') && !endpoint.endsWith('/files')) {
        if (pullFails) {
          return { code: 1, stdout: '', stderr: 'Could not resolve to a PullRequest' };
        }
        return { code: 0, stdout: `${pullSha}\n`, stderr: '' };
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { runner, calls, postedPayloads };
}

async function capture(action: () => Promise<number>): Promise<{ code: number; stderr: string }> {
  const stderr: string[] = [];
  const originalError = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Buffer | Uint8Array) => {
    stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: await action(), stderr: stderr.join('') };
  } finally {
    process.stderr.write = originalError;
  }
}

let stderrOriginal: typeof process.stderr.write;

beforeEach(() => {
  stderrOriginal = process.stderr.write.bind(process.stderr);
});

afterEach(() => {
  process.stderr.write = stderrOriginal;
});

describe('parsePatchRightLines', () => {
  it('collects added and context lines on the right side', () => {
    const patch = [
      '@@ -10,4 +10,5 @@',
      ' keep',
      '-gone',
      '+added',
      ' keep2',
      '+also',
    ].join('\n');

    const lines = parsePatchRightLines(patch);

    expect([...lines].sort((left, right) => left - right)).toEqual([10, 11, 12, 13]);
  });
});

describe('parsePullFiles', () => {
  it('indexes right-side lines by filename and ignores removed files', () => {
    const index = parsePullFiles(JSON.stringify([
      {
        filename: 'src/a.ts',
        status: 'modified',
        patch: '@@ -1,2 +1,2 @@\n-old\n+new\n context',
      },
      {
        filename: 'src/gone.ts',
        status: 'removed',
        patch: '@@ -1,1 +0,0 @@\n-gone',
      },
      {
        filename: 'src/bin.png',
        status: 'added',
        patch: null,
      },
    ]));

    expect(index.has('src/a.ts')).toBe(true);
    expect(index.get('src/a.ts')?.has(1)).toBe(true);
    expect(index.get('src/a.ts')?.has(2)).toBe(true);
    expect(index.has('src/gone.ts')).toBe(false);
    expect(index.has('src/bin.png')).toBe(false);
  });
});

describe('annotateFindings', () => {
  it('returns 0 with no findings and makes no gh calls', async () => {
    const { runner, calls } = makeRunner();

    const result = await capture(() =>
      annotateFindings(7, [], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('posted 0');
    expect(calls).toEqual([]);
  });

  it('posts a multi-line body via --input - JSON (not -f body=)', async () => {
    const { runner, postedPayloads, calls } = makeRunner();
    const finding = makeFinding({
      message: 'Line one.\n\nLine three with **markdown**.',
    });

    const result = await capture(() =>
      annotateFindings(7, [finding], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      'posted 1, skipped 0 (duplicates), out-of-diff 0, failed 0',
    );
    expect(postedPayloads).toHaveLength(1);
    const payload = postedPayloads[0] ?? {};
    expect(payload.body).toContain('Line one.');
    expect(payload.body).toContain('Line three with **markdown**.');
    expect(payload.body).toContain('`csharp.no-todo-without-owner`');
    expect(payload.body).toContain('column 5');
    expect(String(payload.body)).toMatch(/<!-- regent:/);
    expect(payload.commit_id).toBe('abc123');
    expect(payload.path).toBe('src/foo.cs');
    expect(payload.line).toBe(10);
    expect(payload.side).toBe('RIGHT');

    const postCall = calls.find(
      (call) => call.command === 'gh'
        && call.args[1]?.endsWith('/comments')
        && call.args.includes('--method')
        && call.args[call.args.indexOf('--method') + 1] === 'POST',
    );
    expect(postCall).toBeDefined();
    expect(postCall?.args).toContain('--input');
    expect(postCall?.args).toContain('-');
    expect(postCall?.args.some((arg) => arg.startsWith('body='))).toBe(false);
    expect(postCall?.stdin).toContain('"body"');
  });

  it('skips findings whose marker is already present in existing comments', async () => {
    const finding = makeFinding({
      ruleId: 'csharp.no-region',
      path: 'src/bar.cs',
    });
    const marker = `<!-- regent:csharp.no-region|src/bar.cs|10 -->`;
    const { runner, postedPayloads } = makeRunner({
      existingBodies: `previous comment\n${marker}\n`,
    });

    const result = await capture(() =>
      annotateFindings(7, [finding], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      'posted 0, skipped 1 (duplicates), out-of-diff 0, failed 0',
    );
    expect(postedPayloads).toEqual([]);
  });

  it('skips findings whose file+line are outside the PR diff', async () => {
    const { runner, postedPayloads } = makeRunner();
    const finding = makeFinding({
      path: 'src/untouched.cs',
      match: {
        startLine: 99,
        startColumn: 0,
        endLine: 99,
        endColumn: 4,
        matchText: 'TODO',
      },
    });

    const result = await capture(() =>
      annotateFindings(7, [finding], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      'posted 0, skipped 0 (duplicates), out-of-diff 1, failed 0',
    );
    expect(postedPayloads).toEqual([]);
  });

  it('logs path, rule id, and gh stderr when a post fails', async () => {
    const { runner, postedPayloads } = makeRunner({
      postResult: {
        code: 1,
        stderr: 'HTTP 422: Line is not part of the diff',
      },
    });
    const findings = [
      makeFinding(),
      makeFinding({ ruleId: 'csharp.no-region', path: 'src/baz.cs' }),
    ];

    const result = await capture(() =>
      annotateFindings(7, findings, { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'posted 0, skipped 0 (duplicates), out-of-diff 0, failed 2',
    );
    expect(result.stderr).toContain(
      'regent: failed to annotate src/foo.cs:10 (csharp.no-todo-without-owner): HTTP 422: Line is not part of the diff',
    );
    expect(result.stderr).toContain(
      'regent: failed to annotate src/baz.cs:10 (csharp.no-region): HTTP 422: Line is not part of the diff',
    );
    expect(postedPayloads).toHaveLength(2);
  });

  it('fails with exit code 2 when gh is not on the PATH', async () => {
    const { runner } = makeRunner({ missingGh: true });

    const result = await capture(() =>
      annotateFindings(7, [makeFinding()], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('regent: GitHub CLI (gh) is not installed');
    expect(result.stderr).toContain('https://cli.github.com/');
  });

  it('fails with exit code 2 when gh cannot find the pull request', async () => {
    const { runner } = makeRunner({ pullFails: true });

    const result = await capture(() =>
      annotateFindings(42, [makeFinding()], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('pull request #42 was not found');
  });

  it('fails with exit code 2 when PR files cannot be listed', async () => {
    const { runner } = makeRunner({ filesFails: true });

    const result = await capture(() =>
      annotateFindings(7, [makeFinding()], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('could not read PR #7 changed files');
  });

  it('returns 2 for a non-positive pull request number', async () => {
    const { runner, calls } = makeRunner();

    const result = await capture(() =>
      annotateFindings(0, [makeFinding()], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('positive pull request number');
    expect(calls).toEqual([]);
  });
});
