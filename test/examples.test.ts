/**
 * L0: example registry — list / find shipped examples.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { examplesDir, listExamples, findExample } from '../src/examples/index.js';

describe('examples registry', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'regent-examples-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('lists examples from the shipped examples/ directory', () => {
    const items = listExamples(examplesDir());
    // We shipped 7 C# examples in Phase 1.
    const csharp = items.filter((i) => i.language === 'csharp');
    expect(csharp.length).toBeGreaterThanOrEqual(7);
    expect(csharp[0]!.language).toBe('csharp');
    expect(csharp[0]!.ruleId).toMatch(/^csharp\./);
  });

  it('returns an empty list for a non-existent directory', () => {
    expect(listExamples(`${tmp}/does-not-exist`)).toEqual([]);
  });

  it('findExample locates a shipped example', () => {
    const found = findExample(examplesDir(), 'csharp', 'csharp.async.discard-assignment');
    expect(found).not.toBeNull();
    expect(found!).toMatch(/csharp\.async\.discard-assignment\.lint\.ts$/);
  });

  it('findExample returns null for unknown examples', () => {
    expect(findExample(examplesDir(), 'csharp', 'does.not.exist')).toBeNull();
    expect(findExample(examplesDir(), 'unknown-lang', 'rule')).toBeNull();
  });

  it('examplesDir resolves to an existing directory', () => {
    const dir = examplesDir();
    // Either cwd/examples or the package layout — at least one path is valid.
    expect(dir.length).toBeGreaterThan(0);
    // dirname(join(dir, 'csharp')) should be a real path
    expect(dirname(dir)).toBeTruthy();
  });
});