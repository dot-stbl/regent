/**
 * L0: loader — preset + extend + disable/override/add
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defineConfig, defineRule } from '../src/index.js';
import { loadRules } from '../src/loader.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_CWD = join(tmpdir(), `regent-loader-${Date.now()}`);

beforeAll(async () => {
  mkdirSync(join(TEST_CWD, 'tools', 'audit'), { recursive: true });

  writeFileSync(
    join(TEST_CWD, 'tools', 'audit', 'config.js'),
    `export default {
  rules: {
    disable: ['csharp.no-region-directive'],
    override: { 'csharp.no-private-methods': { severity: 'warning' } },
    add: [
      {
        id: 'tessera.sample-rule',
        severity: 'warning',
        pattern: 'sample-thing',
        globs: ['**/*.cs'],
        message: 'sample rule',
      },
    ],
  },
};`,
  );
});

afterAll(() => {
  rmSync(TEST_CWD, { recursive: true, force: true });
});

describe('loadRules', () => {
  it('loads built-in csharp preset by default', async () => {
    const result = await loadRules({
      repoRoot: join(TEST_CWD, 'fake'),
      skipLocal: true,
    });
    const ids = result.rules.map((r) => r.spec.id);
    expect(ids).toContain('csharp.no-region-directive');
    expect(ids).toContain('csharp.no-private-methods');
  });

  it('applies disable from repo config', async () => {
    const result = await loadRules({ repoRoot: TEST_CWD, skipLocal: true });
    const ids = result.rules.map((r) => r.spec.id);
    expect(ids).not.toContain('csharp.no-region-directive');
    expect(ids).toContain('csharp.no-private-methods');
    expect(ids).toContain('tessera.sample-rule');
  });

  it('applies override from repo config', async () => {
    const result = await loadRules({ repoRoot: TEST_CWD, skipLocal: true });
    const overridden = result.rules.find(
      (r) => r.spec.id === 'csharp.no-private-methods',
    );
    expect(overridden?.spec.severity).toBe('warning');
  });
});
