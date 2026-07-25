/**
 * L0: line-based diff — LCS table + unified-diff renderer.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { diffLines, renderUnifiedDiff } from '../src/core/diff.js';
import { cachedDiffPath, runDiff, saveCachedDiff } from '../src/cli/diff.js';
import type { JsonFinding, JsonRunResult } from '../src/reporter/json.js';

const roots: string[] = [];

function finding(ruleId: string, path: string, line: number, severity: JsonFinding['severity']): JsonFinding {
  return {
    ruleId,
    severity,
    path,
    match: { line, column: 1, text: 'match' },
    context: { lines: ['match'], startLine: line, endLine: line },
    message: `${ruleId} message`,
    source: 'fixture',
    status: 'violation',
  };
}

function run(...findings: JsonFinding[]): JsonRunResult {
  return { rules: [], findings, scannedFiles: 1 };
}

function root(): string {
  const path = join(tmpdir(), `regent-diff-${Date.now()}-${String(roots.length)}`);
  mkdirSync(path, { recursive: true });
  roots.push(path);
  return path;
}

async function capture(action: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalError = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: await action(), stdout: stdout.join(''), stderr: stderr.join('') };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalError;
  }
}

afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('diffLines', () => {
  it('returns an empty diff for identical inputs', () => {
    const r = diffLines('a\nb\nc', 'a\nb\nc');
    expect(r.hunks).toEqual([]);
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(0);
  });

  it('returns an empty diff for empty inputs', () => {
    const r = diffLines('', '');
    expect(r.hunks).toEqual([]);
  });

  it('detects a single-line addition', () => {
    const r = diffLines('a\nb', 'a\nb\nc');
    expect(r.additions).toBe(1);
    expect(r.deletions).toBe(0);
    expect(r.hunks.length).toBe(1);
  });

  it('detects a single-line deletion', () => {
    const r = diffLines('a\nb\nc', 'a\nc');
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(1);
    expect(r.hunks.length).toBe(1);
  });

  it('detects a substitution (delete + add)', () => {
    const r = diffLines('hello\n', 'world\n');
    expect(r.additions).toBe(1);
    expect(r.deletions).toBe(1);
  });

  it('handles multi-hunk diffs (changes separated by context)', () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
    const newText = oldText
      .replace('line5', 'CHANGED5')
      .replace('line15', 'CHANGED15');
    const r = diffLines(oldText, newText);
    expect(r.hunks.length).toBeGreaterThanOrEqual(1);
    expect(r.additions).toBe(2);
    expect(r.deletions).toBe(2);
  });

  it('preserves context lines around changes', () => {
    const oldText = 'a\nb\nc\nd\ne';
    const newText = 'a\nb\nC\nd\ne';
    const r = diffLines(oldText, newText);
    // hunk should include surrounding context (3 lines each side).
    const first = r.hunks[0]!;
    const contextLines = first.lines.filter((l) => l.startsWith(' ')).length;
    expect(contextLines).toBeGreaterThanOrEqual(2);
  });
});

describe('renderUnifiedDiff', () => {
  it('renders an empty diff as empty string', () => {
    const r = diffLines('a', 'a');
    expect(renderUnifiedDiff(r, 'foo.txt')).toBe('');
  });

  it('emits the unified-diff header lines', () => {
    const r = diffLines('a', 'b');
    const text = renderUnifiedDiff(r, 'foo.txt');
    expect(text).toMatch(/^--- a\/foo\.txt$/m);
    expect(text).toMatch(/^\+\+\+ b\/foo\.txt$/m);
  });

  it('emits @@ hunk headers', () => {
    const r = diffLines('a\nb', 'a\nB');
    const text = renderUnifiedDiff(r, 'foo.txt');
    expect(text).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
  });
});

describe.sequential('runDiff', () => {
  it('compares the current run with the cached previous run', async () => {
    const cwd = root();
    saveCachedDiff(run(finding('old.rule', 'src/old.ts', 3, 'warning')), cwd);

    const result = await capture(() => runDiff(undefined, {
      cwd,
      currentRun: run(finding('new.rule', 'src/new.ts', 8, 'error')),
    }));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('+ new');
    expect(result.stdout).toContain('src/new.ts:8');
    expect(result.stdout).toContain('- resolved');
    expect(result.stdout).toContain('src/old.ts:3');
    expect(JSON.parse(readFileSync(cachedDiffPath(cwd), 'utf8'))).toMatchObject({ findings: [{ ruleId: 'new.rule' }] });
  });

  it('loads an explicit JSON baseline and emits JSON', async () => {
    const cwd = root();
    const baseline = join(cwd, 'baseline.json');
    writeFileSync(baseline, JSON.stringify(run(finding('old.rule', 'old.ts', 1, 'warning'))));

    const result = await capture(() => runDiff(baseline, {
      cwd,
      format: 'json',
      currentRun: run(finding('new.rule', 'new.ts', 2, 'error')),
    }));

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      new: [{ ruleId: 'new.rule' }],
      resolved: [{ ruleId: 'old.rule' }],
    });
  });

  it('prints nothing when the snapshots are identical', async () => {
    const cwd = root();
    const snapshot = run(finding('same.rule', 'same.ts', 4, 'suggestion'));
    saveCachedDiff(snapshot, cwd);

    const result = await capture(() => runDiff(undefined, { cwd, currentRun: snapshot }));

    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' });
  });

  it('reports a missing baseline file', async () => {
    const cwd = root();

    const result = await capture(() => runDiff('missing.json', { cwd, currentRun: run() }));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('baseline file not found');
  });

  it('reports malformed baseline JSON', async () => {
    const cwd = root();
    writeFileSync(join(cwd, 'bad.json'), '{bad');

    const result = await capture(() => runDiff('bad.json', { cwd, currentRun: run() }));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('could not parse baseline JSON');
  });
});
