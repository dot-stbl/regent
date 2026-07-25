/**
 * L3: PR annotation — body construction, dedupe, gh-not-installed error path.
 */

import { Buffer } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  annotateFindings,
  type AnnotationCommandRunner,
} from '../src/cli/annotate-pr.js';
import type { Finding } from '../src/types.js';

interface CommandCall {
  readonly command: string;
  readonly args: readonly string[];
}

interface ScriptedRunnerOptions {
  readonly pullSha?: string;
  readonly existingBodies?: string;
  readonly missingGh?: boolean;
  readonly pullFails?: boolean;
  readonly commentsFails?: boolean;
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

function makeRunner(options: ScriptedRunnerOptions = {}): {
  runner: AnnotationCommandRunner;
  calls: CommandCall[];
  postedBodies: string[];
} {
  const calls: CommandCall[] = [];
  const postedBodies: string[] = [];
  const pullSha = options.pullSha ?? 'abc123';
  const existingBodies = options.existingBodies ?? '';
  const missingGh = options.missingGh ?? false;
  const pullFails = options.pullFails ?? false;
  const commentsFails = options.commentsFails ?? false;
  const postResult = options.postResult ?? { code: 0 };
  const runner: AnnotationCommandRunner = async (command, args, _cwd) => {
    calls.push({ command, args });
    if (command === 'git') {
      return { code: 0, stdout: 'true', stderr: '' };
    }
    if (command === 'gh' && missingGh) {
      return { code: 2, stdout: '', stderr: 'spawn gh ENOENT', missing: true };
    }
    if (command === 'gh' && args[0] === 'api' && args[1]?.includes('/pulls/') === true && !args[1].endsWith('/comments')) {
      if (pullFails) {
        return { code: 1, stdout: '', stderr: 'Could not resolve to a PullRequest' };
      }
      return { code: 0, stdout: `${pullSha}\n`, stderr: '' };
    }
    if (command === 'gh' && args[1]?.endsWith('/comments') && args[3] !== 'POST') {
      if (commentsFails) {
        return { code: 1, stdout: '', stderr: 'gh api failed' };
      }
      return { code: 0, stdout: existingBodies, stderr: '' };
    }
    if (command === 'gh' && args[1]?.endsWith('/comments')) {
      const bodyIndex = args.indexOf('-f');
      const bodyValue = bodyIndex >= 0 && args[bodyIndex + 1] !== undefined
        ? args[bodyIndex + 1] ?? ''
        : '';
      postedBodies.push(bodyValue);
      return { code: postResult.code, stdout: '', stderr: postResult.stderr ?? '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { runner, calls, postedBodies };
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

  it('posts a comment with the expected body shape and stable marker', async () => {
    const { runner, postedBodies, calls } = makeRunner({
      existingBodies: '',
    });
    const finding = makeFinding();

    const result = await capture(() =>
      annotateFindings(7, [finding], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('posted 1, skipped 0 (duplicates), failed 0');
    expect(postedBodies).toHaveLength(1);
    const body = postedBodies[0] ?? '';
    expect(body).toContain('TODO comment must declare an owner.');
    expect(body).toContain('`csharp.no-todo-without-owner`');
    expect(body).toContain('column 5');
    expect(body).toMatch(
      /<!-- regent:[A-Za-z0-9.-]+|[A-Za-z0-9./|]+|10 -->/,
    );

    const postCall = calls.find(
      (c) => c.command === 'gh'
        && c.args[1]?.endsWith('/comments')
        && c.args.includes('--method')
        && c.args[c.args.indexOf('--method') + 1] === 'POST',
    );
    expect(postCall).toBeDefined();
    expect(postCall?.args).toContain('POST');
    expect(postCall?.args).toContain('path=src/foo.cs');
    expect(postCall?.args).toContain('-F');
    expect(postCall?.args).toContain('line=10');
    expect(postCall?.args).toContain('commit_id=abc123');
  });

  it('skips findings whose marker is already present in existing comments', async () => {
    const finding = makeFinding({
      ruleId: 'csharp.no-region',
      path: 'src/bar.cs',
    });
    const marker = `<!-- regent:csharp.no-region|src/bar.cs|10 -->`;
    const { runner, postedBodies } = makeRunner({
      existingBodies: `previous comment\n${marker}\n`,
    });

    const result = await capture(() =>
      annotateFindings(7, [finding], { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('posted 0, skipped 1 (duplicates), failed 0');
    expect(postedBodies).toEqual([]);
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

  it('reports a failed post without aborting the whole run', async () => {
    const { runner, postedBodies } = makeRunner({
      postResult: { code: 1, stderr: 'rate limited' },
    });
    const findings = [
      makeFinding(),
      makeFinding({ ruleId: 'csharp.no-region', path: 'src/baz.cs' }),
    ];

    const result = await capture(() =>
      annotateFindings(7, findings, { cwd: '/repo', runCommand: runner }),
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('posted 0, skipped 0 (duplicates), failed 2');
    expect(postedBodies).toHaveLength(2);
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

void Buffer;
