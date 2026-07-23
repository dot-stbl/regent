/**
 * L0: config schema validation via Zod.
 */

import { describe, expect, it } from 'vitest';

import { safeParseConfig } from '../src/config/schema.js';

describe('RegentConfigSchema', () => {
  it('accepts an empty config (uses all defaults)', () => {
    const result = safeParseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rules.detect).toEqual([]);
      expect(result.value.rules.fix).toEqual([]);
      expect(result.value.excludePaths).toEqual([]);
      expect(result.value.cache.enabled).toBe(true);
      expect(result.value.log.level).toBe('info');
    }
  });

  it('rejects unknown top-level keys (strict mode)', () => {
    const result = safeParseConfig({ unknownField: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/unknownField/);
    }
  });

  it('rejects unknown keys in cache config', () => {
    const result = safeParseConfig({
      rules: { detect: [], fix: [] },
      cache: { enabled: true, maxBytes: 1024, extraField: 'x' },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts valid detect rule spec', () => {
    const result = safeParseConfig({
      rules: {
        detect: [
          {
            id: 'csharp.no-region',
            severity: 'error',
            pattern: '\\s*#region',
            globs: ['**/*.cs'],
            message: 'no #region',
          },
        ],
        fix: [],
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects detect rule with missing required fields', () => {
    const result = safeParseConfig({
      rules: {
        detect: [
          {
            id: 'broken',
            severity: 'error',
            // missing pattern, globs, message
          },
        ],
        fix: [],
      },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts @group references in excludePaths', () => {
    const result = safeParseConfig({
      rules: { detect: [], fix: [] },
      excludePaths: ['@generated', '**/legacy/**'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects invalid @group references (path separators)', () => {
    const result = safeParseConfig({
      rules: { detect: [], fix: [] },
      excludePaths: ['@foo/bar'],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts lowercase kebab-case user-defined excludeGroups', () => {
    const result = safeParseConfig({
      rules: { detect: [], fix: [] },
      excludeGroups: {
        'contract-tests': ['**/ContractTests/**'],
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects user-defined groups with bad names', () => {
    const result = safeParseConfig({
      rules: { detect: [], fix: [] },
      excludeGroups: {
        'BadName': ['**/*.cs'],  // uppercase not allowed
      },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts valid fix rule spec', () => {
    const result = safeParseConfig({
      rules: {
        detect: [],
        fix: [
          {
            id: 'meta.trailing-whitespace',
            severity: 'warning',
            find: '\\s+$',
            replace: '',
            globs: ['**/*'],
            message: 'trailing whitespace',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects fix rule with unknown fields (strict mode)', () => {
    const result = safeParseConfig({
      rules: {
        detect: [],
        fix: [
          {
            id: 'broken',
            severity: 'warning',
            find: 'a',
            replace: 'b',
            globs: ['**/*'],
            message: 'm',
            extraField: 'nope',
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects severity values outside the enum', () => {
    const result = safeParseConfig({
      rules: {
        detect: [
          {
            id: 'broken',
            severity: 'red',  // not in enum
            pattern: 'x',
            globs: ['**/*'],
            message: 'm',
          },
        ],
        fix: [],
      },
    });
    expect(result.ok).toBe(false);
  });

  it('validates log.level enum', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      const result = safeParseConfig({
        rules: { detect: [], fix: [] },
        log: { level, format: 'text' },
      });
      expect(result.ok).toBe(true);
    }
    const badResult = safeParseConfig({
      rules: { detect: [], fix: [] },
      log: { level: 'screaming', format: 'text' },
    });
    expect(badResult.ok).toBe(false);
  });

  it('validates log.format enum', () => {
    const bad = safeParseConfig({
      rules: { detect: [], fix: [] },
      log: { level: 'info', format: 'xml' },
    });
    expect(bad.ok).toBe(false);
  });

  // Issue #35: scope declaration in the root config.
  it('accepts a scopes map with valid kebab-case names', () => {
    const result = safeParseConfig({
      scopes: {
        frontend: { root: 'apps/web' },
        'my-backend': { root: 'src' },
      },
      rules: { detect: [], fix: [] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value.scopes).sort()).toEqual(['frontend', 'my-backend']);
    }
  });

  it('defaults scopes to an empty map when omitted (single-project)', () => {
    const result = safeParseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scopes).toEqual({});
    }
  });

  it('rejects scope names with uppercase letters', () => {
    const result = safeParseConfig({
      scopes: { Frontend: { root: 'apps/web' } },
      rules: { detect: [], fix: [] },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects scope names with underscores (CLI -s a_b would be ambiguous)', () => {
    const result = safeParseConfig({
      scopes: { my_scope: { root: 'src' } },
      rules: { detect: [], fix: [] },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects scopes entries missing `root`', () => {
    const result = safeParseConfig({
      scopes: { frontend: {} },
      rules: { detect: [], fix: [] },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects scopes entries with unknown fields (strict mode)', () => {
    const result = safeParseConfig({
      scopes: { frontend: { root: 'apps/web', extends: 'whatever' } },
      rules: { detect: [], fix: [] },
    });
    expect(result.ok).toBe(false);
  });
});