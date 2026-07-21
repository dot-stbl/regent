/**
 * L1: transformer pipeline tests
 *
 * Covers:
 * - Single transform rule per file
 * - Multiple transform rules chained in registration order
 * - Globs filter which rules apply to which file
 * - Files with no matching rules are skipped (no read, no result)
 * - Pure + deterministic contract: same input → same output
 * - changedFiles contains only files whose content actually changed
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runTransforms } from '../src/transformer.js';
import type { CompiledTransformRule } from '../src/kinds/transform.js';

let cwd = '';

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'regent-transform-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function fakeRule(
  id: string,
  globs: readonly string[],
  transform: (filePath: string, content: string) => string,
): CompiledTransformRule {
  return {
    spec: {
      id,
      severity: 'warning',
      globs: [...globs],
      message: 'transform',
      transform,
    },
    source: '<test>',
    origin: { kind: 'repo', path: cwd },
  };
}

describe('runTransforms', () => {
  it('applies a single matching transform rule and reports the change', async () => {
    writeFileSync(join(cwd, 'a.ts'), 'hello');

    const rule = fakeRule(
      'upper',
      ['**/*.ts'],
      (_file, content) => content.toUpperCase(),
    );

    const out = await runTransforms({
      cwd,
      files: [join(cwd, 'a.ts')],
      transformRules: [rule],
    });

    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.originalContent).toBe('hello');
    expect(out.results[0]!.transformedContent).toBe('HELLO');
    expect(out.results[0]!.appliedRuleIds).toEqual(['upper']);
    expect(out.changedFiles).toEqual([join(cwd, 'a.ts')]);
  });

  it('skips files with no matching rule globs', async () => {
    writeFileSync(join(cwd, 'a.md'), 'hi');
    writeFileSync(join(cwd, 'a.ts'), 'hi');

    const rule = fakeRule(
      'ts-only',
      ['**/*.ts'],
      (_file, content) => content.toUpperCase(),
    );

    const out = await runTransforms({
      cwd,
      files: [join(cwd, 'a.md'), join(cwd, 'a.ts')],
      transformRules: [rule],
    });

    expect(out.results).toHaveLength(1);
    expect(out.changedFiles).toEqual([join(cwd, 'a.ts')]);
  });

  it('chains multiple matching rules in registration order', async () => {
    writeFileSync(join(cwd, 'a.ts'), 'hello');

    const rules: CompiledTransformRule[] = [
      fakeRule('upper', ['**/*.ts'], (_f, c) => c.toUpperCase()),
      fakeRule('exclaim', ['**/*.ts'], (_f, c) => `${c}!`),
    ];

    const out = await runTransforms({
      cwd,
      files: [join(cwd, 'a.ts')],
      transformRules: rules,
    });

    expect(out.results[0]!.transformedContent).toBe('HELLO!');
    expect(out.results[0]!.appliedRuleIds).toEqual(['upper', 'exclaim']);
  });

  it('does not flag unchanged files in changedFiles', async () => {
    writeFileSync(join(cwd, 'a.ts'), 'hello');

    const rule = fakeRule(
      'no-op',
      ['**/*.ts'],
      (_file, content) => content,
    );

    const out = await runTransforms({
      cwd,
      files: [join(cwd, 'a.ts')],
      transformRules: [rule],
    });

    expect(out.results).toHaveLength(1);
    expect(out.changedFiles).toEqual([]);
    expect(out.results[0]!.appliedRuleIds).toEqual(['no-op']);
  });

  it('is deterministic: same input → same output across calls', async () => {
    writeFileSync(join(cwd, 'a.ts'), 'hello');

    const rule = fakeRule(
      'shout',
      ['**/*.ts'],
      (_file, content) => `${content}!!!`,
    );

    const out1 = await runTransforms({
      cwd,
      files: [join(cwd, 'a.ts')],
      transformRules: [rule],
    });
    const out2 = await runTransforms({
      cwd,
      files: [join(cwd, 'a.ts')],
      transformRules: [rule],
    });

    expect(out1.results[0]!.transformedContent).toBe(
      out2.results[0]!.transformedContent,
    );
  });
});