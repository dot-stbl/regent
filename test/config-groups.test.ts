/**
 * L0: built-in exclude groups.
 */

import { describe, expect, it } from 'vitest';

import {
  BUILTIN_EXCLUDE_GROUPS,
  GROUP_PREFIX,
  groupNameFromReference,
  isGroupReference,
  findBuiltinGroup,
} from '../src/config/groups.js';

describe('BUILTIN_EXCLUDE_GROUPS', () => {
  it('contains the documented set', () => {
    const names = BUILTIN_EXCLUDE_GROUPS.map((g) => g.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'generated',
        'migrations',
        'build-output',
        'node-modules',
        'git',
        'ide',
        'vendored',
      ]),
    );
  });

  it('every group name is lowercase kebab-case', () => {
    for (const g of BUILTIN_EXCLUDE_GROUPS) {
      expect(g.name).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('every group has at least one glob', () => {
    for (const g of BUILTIN_EXCLUDE_GROUPS) {
      expect(g.globs.length).toBeGreaterThan(0);
    }
  });
});

describe('isGroupReference', () => {
  it('accepts @name with kebab-case name', () => {
    expect(isGroupReference('@generated')).toBe(true);
    expect(isGroupReference('@build-output')).toBe(true);
    expect(isGroupReference('@my-group-2')).toBe(true);
  });

  it('rejects strings without @ prefix', () => {
    expect(isGroupReference('generated')).toBe(false);
    expect(isGroupReference('**/*.cs')).toBe(false);
    expect(isGroupReference('')).toBe(false);
  });

  it('rejects @ with empty name', () => {
    expect(isGroupReference('@')).toBe(false);
  });

  it('rejects @ with path separators', () => {
    expect(isGroupReference('@foo/bar')).toBe(false);
    expect(isGroupReference('@foo\\bar')).toBe(false);
  });
});

describe('groupNameFromReference', () => {
  it('strips the @ prefix', () => {
    expect(groupNameFromReference('@generated')).toBe('generated');
    expect(groupNameFromReference('@build-output')).toBe('build-output');
  });
});

describe('GROUP_PREFIX', () => {
  it('is @', () => {
    expect(GROUP_PREFIX).toBe('@');
  });
});

describe('findBuiltinGroup', () => {
  it('returns the group when found', () => {
    const g = findBuiltinGroup('generated');
    expect(g).toBeDefined();
    expect(g?.source).toBe('builtin');
    expect(g?.globs).toContain('**/Generated/**');
  });

  it('returns undefined when not found', () => {
    expect(findBuiltinGroup('does-not-exist')).toBeUndefined();
  });
});