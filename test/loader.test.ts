/**
 * L0: loader — extend + disable/override/add
 *
 * v0.2 ships zero built-in rules; the tests below confirm the loader
 * honours repo-level config (extends, disable, override, add) without
 * assuming any preset content.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadRules } from '../src/loader.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_CWD = join(tmpdir(), `regent-loader-${Date.now()}`);

beforeAll(async () => {
  mkdirSync(join(TEST_CWD, 'tools', 'audit'), { recursive: true });

  // Config with `add` only — confirms rules from config are loaded.
  writeFileSync(
    join(TEST_CWD, 'tools', 'audit', 'config.js'),
    `export default {
  rules: {
    add: [
      {
        id: 'tessera.no-region-directive',
        severity: 'error',
        pattern: '\\\\s*#region\\\\b',
        globs: ['**/*.cs'],
        message: 'no #region',
      },
      {
        id: 'tessera.no-private-methods',
        severity: 'error',
        pattern: 'private\\\\s+void',
        globs: ['**/*.cs'],
        message: 'no private methods',
      },
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

  // Separate config in its own subdir for disable/override testing.
  // The order is: add first, then disable/override (so add-defined rules
  // can be referenced).
  const SUBCWD = join(TEST_CWD, 'sub');
  mkdirSync(join(SUBCWD, 'tools', 'audit'), { recursive: true });
  writeFileSync(
    join(SUBCWD, 'tools', 'audit', 'config.js'),
    `export default {
  rules: {
    add: [
      {
        id: 'tessera.no-region-directive',
        severity: 'error',
        pattern: '\\\\s*#region\\\\b',
        globs: ['**/*.cs'],
        message: 'no #region',
      },
      {
        id: 'tessera.no-private-methods',
        severity: 'error',
        pattern: 'private\\\\s+void',
        globs: ['**/*.cs'],
        message: 'no private methods',
      },
    ],
    disable: ['tessera.no-region-directive'],
    override: { 'tessera.no-private-methods': { severity: 'warning' } },
  },
};`,
  );
});

afterAll(() => {
  rmSync(TEST_CWD, { recursive: true, force: true });
});

describe('loadRules', () => {
  it('loads no rules when no config and no examples exist', async () => {
    const result = await loadRules({
      repoRoot: join(TEST_CWD, 'fake'),
      skipLocal: true,
    });
    expect(result.rules).toHaveLength(0);
  });

  it('loads rules from repo config (add)', async () => {
    const result = await loadRules({ repoRoot: TEST_CWD, skipLocal: true });
    const ids = result.rules.map((r) => r.spec.id);
    expect(ids).toContain('tessera.sample-rule');
    expect(ids).toContain('tessera.no-region-directive');
    expect(ids).toContain('tessera.no-private-methods');
  });

  it('applies disable + override from repo config', async () => {
    const result = await loadRules({
      repoRoot: join(TEST_CWD, 'sub'),
      skipLocal: true,
    });
    const ids = result.rules.map((r) => r.spec.id);
    expect(ids).not.toContain('tessera.no-region-directive'); // disabled
    expect(ids).toContain('tessera.no-private-methods');
    const overridden = result.rules.find(
      (r) => r.spec.id === 'tessera.no-private-methods',
    );
    expect(overridden?.spec.severity).toBe('warning'); // overridden
  });
});
