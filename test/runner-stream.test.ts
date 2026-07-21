/**
 * L0: streaming runner — `runRulesStream` yields findings incrementally + a
 * terminal `done`, and `runRules` (collect-all wrapper) matches it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runRules, runRulesStream } from '../src/runner.js';
import { defineRule } from '../src/define-rule.js';

const DIR = join(tmpdir(), `regent-stream-${Date.now()}`);
const RULE = defineRule({
  id: 'stream.no-region',
  severity: 'error',
  pattern: '#region',
  globs: ['**/*.cs'],
  message: 'no #region',
});
const scope = () => ({
  cwd: DIR,
  includeGlobs: ['**/*.cs'],
  excludeGlobs: [],
  changedOnly: false,
  diffBase: 'HEAD',
});

beforeAll(() => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'a.cs'), '#region\nint x;\n');
  writeFileSync(join(DIR, 'b.cs'), 'class B { void M() { /* #region */ int y; } }\n#region\n');
  writeFileSync(join(DIR, 'c.cs'), 'int clean;\n');
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('runRulesStream', () => {
  it('yields findings incrementally then a done event', async () => {
    const ids: string[] = [];
    let progress = 0;
    let doneScanned = -1;
    for await (const ev of runRulesStream([RULE], scope())) {
      if (ev.type === 'finding') {
        ids.push(ev.finding.ruleId);
      } else if (ev.type === 'progress') {
        progress++;
        expect(ev.total).toBe(3);
      } else if (ev.type === 'done') {
        doneScanned = ev.scannedFiles;
      }
    }
    expect(ids.length).toBeGreaterThanOrEqual(2); // a.cs + b.cs both have #region
    expect(progress).toBe(3); // one progress event per file
    expect(doneScanned).toBe(3);
  });

  it('runRules (collect-all wrapper) matches the streamed findings', async () => {
    const streamed: string[] = [];
    for await (const ev of runRulesStream([RULE], scope())) {
      if (ev.type === 'finding') {
        streamed.push(`${ev.finding.path}:${ev.finding.match.startLine}`);
      }
    }
    const result = await runRules([RULE], scope());
    const collected = result.findings.map((f) => `${f.path}:${f.match.startLine}`);
    expect(collected.sort()).toEqual(streamed.sort());
    expect(result.scannedFiles).toBe(3);
  });
});
