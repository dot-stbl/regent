/**
 * L0: config merge pipeline.
 */

import { describe, expect, it } from 'vitest';

import { mergeConfigs, expandExcludePaths } from '../src/config/merge.js';
import { defaultConfig } from '../src/config/sources/defaults.js';
import type { RegentConfig } from '../src/config/schema.js';
import { BUILTIN_EXCLUDE_GROUPS } from '../src/config/groups.js';

function layer(partial: Partial<RegentConfig>): RegentConfig {
  const def = defaultConfig();
  return {
    ...def,
    ...partial,
    rules: {
      detect: partial.rules?.detect ?? [],
      fix: partial.rules?.fix ?? [],
      ast: partial.rules?.ast ?? [],
      extends: partial.rules?.extends ?? [],
      disable: partial.rules?.disable ?? [],
      override: partial.rules?.override ?? {},
      configure: partial.rules?.configure ?? {},
      accept: partial.rules?.accept ?? [],
    },
    excludePaths: partial.excludePaths ?? def.excludePaths,
    excludeGroups: partial.excludeGroups ?? def.excludeGroups,
    cache: { ...def.cache, ...partial.cache },
    log: { ...def.log, ...partial.log },
    output: { ...def.output, ...partial.output },
  };
}

const GROUP_MAP = new Map(BUILTIN_EXCLUDE_GROUPS.map((g) => [g.name, g] as const));

describe('mergeConfigs', () => {
  it('returns defaults when given only the default layer', () => {
    const merged = mergeConfigs([defaultConfig()]);
    expect(merged.rules.detect).toEqual([]);
    expect(merged.cache.enabled).toBe(true);
    expect(merged.log.level).toBe('info');
  });

  it('last-wins for scalar fields', () => {
    const a = layer({ log: { level: 'debug', format: 'text' } });
    const b = layer({ log: { level: 'error', format: 'json' } });
    const merged = mergeConfigs([a, b]);
    expect(merged.log.level).toBe('error');
    expect(merged.log.format).toBe('json');
  });

  it('concatenates excludePaths across layers', () => {
    const a = layer({ excludePaths: ['**/a/**'] });
    const b = layer({ excludePaths: ['**/b/**'] });
    const merged = mergeConfigs([a, b]);
    expect(merged.excludePaths).toEqual(['**/a/**', '**/b/**']);
  });

  it('expands @group references in excludePaths', () => {
    const a = layer({ excludePaths: ['@generated'] });
    const merged = mergeConfigs([a]);
    // built-in @generated globs should appear in resolved list
    expect(merged.excludePaths.length).toBeGreaterThan(0);
    expect(merged.excludePaths).toContain('**/Generated/**');
  });

  it('throws on unknown @group reference', () => {
    const a = layer({ excludePaths: ['@does-not-exist'] });
    expect(() => mergeConfigs([a])).toThrow(/unknown exclude group/);
  });

  it('uses user-defined groups from higher layers', () => {
    const a = layer({
      excludeGroups: { 'contract-tests': ['**/ContractTests/**'] },
    });
    const b = layer({ excludePaths: ['@contract-tests'] });
    const merged = mergeConfigs([a, b]);
    expect(merged.excludePaths).toContain('**/ContractTests/**');
  });

  it('user-defined groups override built-ins (last-wins)', () => {
    const a = layer({
      excludeGroups: { generated: ['**/custom-only/**'] },
    });
    const merged = mergeConfigs([a]);
    expect(merged.excludeGroups['generated']).toEqual(['**/custom-only/**']);
  });

  it('last-wins for rules.detect (same id)', () => {
    const a = layer({
      rules: {
        detect: [
          {
            id: 'same',
            severity: 'error',
            pattern: 'first',
            globs: ['**/*.cs'],
            message: 'first',
          },
        ],
        fix: [],
      },
    });
    const b = layer({
      rules: {
        detect: [
          {
            id: 'same',
            severity: 'warning',
            pattern: 'second',
            globs: ['**/*.cs'],
            message: 'second',
          },
        ],
        fix: [],
      },
    });
    const merged = mergeConfigs([a, b]);
    expect(merged.rules.detect).toHaveLength(1);
    expect(merged.rules.detect[0]!.pattern).toBe('second');
    expect(merged.rules.detect[0]!.severity).toBe('warning');
  });

  it('keeps unique rules across layers', () => {
    const a = layer({
      rules: {
        detect: [
          {
            id: 'a-only',
            severity: 'error',
            pattern: 'p',
            globs: ['**/*.cs'],
            message: 'm',
          },
        ],
        fix: [],
      },
    });
    const b = layer({
      rules: {
        detect: [
          {
            id: 'b-only',
            severity: 'error',
            pattern: 'p',
            globs: ['**/*.cs'],
            message: 'm',
          },
        ],
        fix: [],
      },
    });
    const merged = mergeConfigs([a, b]);
    const ids = merged.rules.detect.map((r) => r.id);
    expect(ids).toContain('a-only');
    expect(ids).toContain('b-only');
  });

  it('deduplicates excludePaths', () => {
    const a = layer({ excludePaths: ['**/x/**', '**/y/**'] });
    const b = layer({ excludePaths: ['**/x/**', '**/z/**'] });
    const merged = mergeConfigs([a, b]);
    // '**/x/**' should appear only once
    const occurrences = merged.excludePaths.filter((p) => p === '**/x/**').length;
    expect(occurrences).toBe(1);
  });
});

describe('expandExcludePaths', () => {
  it('passes through plain globs', () => {
    const result = expandExcludePaths(['**/a/**', '**/b/**'], GROUP_MAP);
    expect(result).toEqual(['**/a/**', '**/b/**']);
  });

  it('expands a single @group', () => {
    const result = expandExcludePaths(['@generated'], GROUP_MAP);
    expect(result).toContain('**/Generated/**');
  });

  it('expands a mixed list', () => {
    const result = expandExcludePaths(['**/a/**', '@build-output'], GROUP_MAP);
    expect(result).toContain('**/a/**');
    expect(result).toContain('**/bin/**');
    expect(result).toContain('**/obj/**');
  });

  it('throws on unknown group', () => {
    expect(() => expandExcludePaths(['@unknown'], GROUP_MAP)).toThrow(/unknown group/);
  });
});