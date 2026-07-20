/**
 * L0: context buffer plumbing — wires `STBL_REGENT_OUTPUT_CONTEXT_BUFFER`
 * through to the runner's findings.
 *
 * v0.2.1 fix: env.ts parsed the var into `output.contextBuffer`, but
 * the runner imported `DEFAULT_CONTEXT_BUFFER` directly and discarded
 * the resolved value. These tests pin the new behaviour:
 *
 *   - default (no option, no config override) → 3 lines of context
 *   - explicit `RunOptions.contextBuffer` → that many lines on each side
 *   - env var `STBL_REGENT_OUTPUT_CONTEXT_BUFFER` → reaches the runner
 *     via `resolvedConfig.output.contextBuffer`
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { defineRule } from '../src/define-rule.js';
import { loadRules } from '../src/loader.js';
import { runRules, type RunOptions } from '../src/runner.js';

const TEST_CWD = join(tmpdir(), `regent-context-buffer-${Date.now()}`);

// Build a 12-line file with a `#region` on line 6. With buffer N the
// expected `context.lines.length` is `min(2N+1, totalLines)` (when the
// match sits far from the file edges).
const LINES = [
  'public class A',     // 0
  '{',                  // 1
  '    int x;',         // 2
  '    int y;',         // 3
  '    int z;',         // 4
  '    int w;',         // 5
  '    #region',        // 6  <-- match
  '    int q;',         // 7
  '    int r;',         // 8
  '    int s;',         // 9
  '    int t;',         // 10
  '}',                  // 11
];

beforeAll(() => {
  mkdirSync(TEST_CWD, { recursive: true });
  // No trailing empty string — keep the file at exactly LINES.length
  // lines when split on '\n'. A trailing newline produces an empty
  // 13th entry which would skew the file-edge clamp test below.
  writeFileSync(join(TEST_CWD, 'sample.cs'), LINES.join('\n'));
});

afterAll(() => {
  rmSync(TEST_CWD, { recursive: true, force: true });
});

const NO_REGION = defineRule({
  id: 'ctx.no-region',
  severity: 'error',
  pattern: '^\\s*#region\\b',
  globs: ['**/*.cs'],
  message: 'no #region',
});

function scope(): Parameters<typeof runRules>[1] {
  return {
    cwd: TEST_CWD,
    includeGlobs: ['**/*.cs'],
    excludeGlobs: [],
    changedOnly: false,
    diffBase: 'HEAD',
  };
}

async function runWith(options: RunOptions): Promise<number> {
  const result = await runRules([NO_REGION], scope(), options);
  expect(result.findings).toHaveLength(1);
  return result.findings[0]!.context.lines.length;
}

describe('RunOptions.contextBuffer', () => {
  it('defaults to 3 lines on each side when no option is provided', async () => {
    // 7 lines total — start-3..end+3 with the match at line 6.
    const len = await runWith({});
    expect(len).toBe(7);
  });

  it('produces 11 lines of context when contextBuffer is 5', async () => {
    // start-5..end+5 = 11 lines; the file has 12 lines and the match
    // sits at line 6, so the window is bounded only by buffer size.
    const len = await runWith({ contextBuffer: 5 });
    expect(len).toBe(11);
  });

  it('clamps to the file edges when buffer extends past start/end', async () => {
    // Match is on line 6 of a 12-line file; buffer=10 would normally
    // produce 21 lines but the file only has 12, so extractContext
    // clamps to the actual file size.
    const len = await runWith({ contextBuffer: 10 });
    expect(len).toBe(LINES.length);
  });

  it('produces just the matching line when contextBuffer is 0', async () => {
    const len = await runWith({ contextBuffer: 0 });
    expect(len).toBe(1);
    expect(len).toBeGreaterThanOrEqual(1);
  });

  it('treats contextBuffer === 0 as no padding (window covers only the match)', async () => {
    const result = await runRules([NO_REGION], scope(), { contextBuffer: 0 });
    const f = result.findings[0]!;
    expect(f.context.startLine).toBe(6);
    expect(f.context.endLine).toBe(6);
    expect(f.context.lines).toEqual(['    #region']);
  });
});

describe('env var STBL_REGENT_OUTPUT_CONTEXT_BUFFER reaches the runner', () => {
  // Save and restore env so this test is hermetic.
  const ENV_KEY = 'STBL_REGENT_OUTPUT_CONTEXT_BUFFER';
  const PREV = process.env[ENV_KEY];

  afterAll(() => {
    if (PREV === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = PREV;
    }
  });

  it('loadRules() resolves output.contextBuffer to the env value', async () => {
    process.env[ENV_KEY] = '7';

    const loaded = await loadRules({ repoRoot: TEST_CWD, skipLocal: true });
    // The env var wins because no .regentrc.js overrides it.
    expect(loaded.resolvedConfig.output.contextBuffer).toBe(7);

    // Test the wiring directly: pass the resolved value into the
    // runner. loadRules()'s discovery returns zero rules here (no
    // .regentrc.js in TEST_CWD); the rule under test is inlined below.
    const result = await runRules([NO_REGION], scope(), {
      acceptList: loaded.acceptList,
      contextBuffer: loaded.resolvedConfig.output.contextBuffer,
    });
    expect(result.findings).toHaveLength(1);
    // start-7..end+7 = 15 lines requested; match at line 6 of 12 lines
    // → clamped to the file (12).
    expect(result.findings[0]!.context.lines.length).toBe(LINES.length);
  });
});