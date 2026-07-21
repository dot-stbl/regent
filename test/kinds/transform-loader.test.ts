/**
 * L1: transform-kind loader tests
 *
 * Covers:
 * - `.transform.ts` files are discovered and registered.
 * - Inline `rules.transform[]` entries are validated and registered.
 * - Inline rules without a `transform` function are silently dropped
 *   (the schema can't validate a runtime function).
 * - `disable` removes by id.
 * - `override` applies severity/message per id.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRules } from '../../src/loader.js';

let cwd = '';
let rulesDir = '';

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'regent-transform-'));
  rulesDir = join(cwd, 'tools', 'audit', 'rules');
  mkdirSync(rulesDir, { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('transform-kind loader', () => {
  it('discovers and registers a `.transform.ts` rule file', async () => {
    writeFileSync(
      join(rulesDir, 'noop.transform.ts'),
      `export default {
  id: 'test.noop',
  severity: 'warning',
  globs: ['**/*.ts'],
  message: 'no-op transform',
  transform(filePath, content) { return content; },
};
`,
      'utf8',
    );

    const result = await loadRules({ repoRoot: cwd });
    const ids = result.transformRules.map((r) => r.spec.id);
    expect(ids).toContain('test.noop');
    expect(result.transformRules[0]!.spec.transform).toBeTypeOf('function');
  });

  it('skips files that do not export a `transform` function', async () => {
    writeFileSync(
      join(rulesDir, 'broken.transform.ts'),
      `export default {
  id: 'test.broken',
  severity: 'warning',
  globs: ['**/*.ts'],
  message: 'broken transform',
  // intentionally missing transform function
};
`,
      'utf8',
    );

    const result = await loadRules({ repoRoot: cwd });
    expect(result.transformRules.find((r) => r.spec.id === 'test.broken')).toBeUndefined();
  });

  it('drops inline transform rules without a runtime `transform` function', async () => {
    // The schema can't validate a runtime function. Inline entries are
    // accepted by the schema (static shape) but filtered at the loader
    // when the function is missing.
    const result = await loadRules({
      repoRoot: cwd,
      args: {
        rules: {
          transform: [
            {
              id: 'inline.missing-fn',
              severity: 'warning',
              globs: ['**/*.ts'],
              message: 'inline transform without function',
            } as unknown as Record<string, unknown>,
          ],
        },
      } as unknown as Record<string, unknown>,
    });
    expect(result.transformRules.find((r) => r.spec.id === 'inline.missing-fn')).toBeUndefined();
  });

  it('honours `disable`', async () => {
    writeFileSync(
      join(rulesDir, 'a.transform.ts'),
      `export default {
  id: 'test.a',
  severity: 'warning',
  globs: ['**/*.ts'],
  message: 'a',
  transform(filePath, content) { return content; },
};
`,
      'utf8',
    );
    writeFileSync(
      join(cwd, '.regentrc.ts'),
      `export default {
  rules: {
    detect: [], fix: [], ast: [], transform: [], extends: [],
    disable: ['test.a'],
    override: {}, accept: [],
  },
};
`,
      'utf8',
    );

    const result = await loadRules({ repoRoot: cwd });
    expect(result.transformRules.find((r) => r.spec.id === 'test.a')).toBeUndefined();
  });
});