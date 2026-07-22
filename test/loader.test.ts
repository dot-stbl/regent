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
  mkdirSync(TEST_CWD, { recursive: true });

  // Config with inline rules only — confirms rules from config are
  // loaded via the new loadConfig() pipeline (.regentrc.js).
  writeFileSync(
    join(TEST_CWD, '.regentrc.js'),
    `export default {
  rules: {
    detect: [
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
  const SUBCWD = join(TEST_CWD, 'sub');
  mkdirSync(SUBCWD, { recursive: true });
  writeFileSync(
    join(SUBCWD, '.regentrc.js'),
    `export default {
  rules: {
    detect: [
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
    // Use a fully-isolated tmpdir so cosmiconfig walks up find no
    // .regentrc anywhere up to root. Also repoint the user-global
    // layer at its own fresh tmpdir so the developer's house-rules
    // pickup under `~/.agents/rules/` doesn't leak into the
    // "empty config" assertion.
    const isolated = join(tmpdir(), `regent-loader-empty-${Date.now()}`);
    mkdirSync(isolated, { recursive: true });
    const previousGlobal = process.env['STBL_REGENT_GLOBAL_RULES_PATH'];
    process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = isolated;
    try {
      const result = await loadRules({ repoRoot: isolated, skipLocal: true });
      expect(result.rules).toHaveLength(0);
    } finally {
      if (previousGlobal === undefined) {
        delete process.env['STBL_REGENT_GLOBAL_RULES_PATH'];
      } else {
        process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = previousGlobal;
      }
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('loads rules from repo config (detect)', async () => {
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
