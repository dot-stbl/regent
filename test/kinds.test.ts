/**
 * L0: defineDetectRule / defineFixRule — type-safe + frozen.
 */

import { describe, expect, it } from 'vitest';

import { defineDetectRule, defineFixRule } from '../src/kinds/index.js';

describe('defineDetectRule', () => {
  it('returns the rule unchanged', () => {
    const rule = defineDetectRule({
      id: 'test.no-foo',
      severity: 'error',
      pattern: '\\bfoo\\b',
      globs: ['**/*.ts'],
      message: 'no foo',
    });
    expect(rule.id).toBe('test.no-foo');
  });

  it('freezes the rule object', () => {
    const rule = defineDetectRule({
      id: 'test.frozen',
      severity: 'error',
      pattern: 'x',
      globs: ['**/*'],
      message: 'm',
    });
    expect(Object.isFrozen(rule)).toBe(true);
  });

  it('accepts review-mode fields', () => {
    const rule = defineDetectRule({
      id: 'test.review',
      severity: 'warning',
      pattern: 'TODO',
      globs: ['**/*.ts'],
      message: 'TODO without owner',
      review: {
        enabled: true,
        exitBehavior: 'unreviewed-fails',
        guidance: 'add a ticket reference',
      },
    });
    expect(rule.review?.enabled).toBe(true);
    expect(rule.review?.exitBehavior).toBe('unreviewed-fails');
  });

  it('accepts dependsOn for inter-rule ordering', () => {
    const rule = defineDetectRule({
      id: 'test.dep',
      severity: 'error',
      pattern: 'x',
      globs: ['**/*'],
      message: 'm',
      dependsOn: ['other-rule'],
    });
    expect(rule.dependsOn).toEqual(['other-rule']);
  });
});

describe('defineFixRule', () => {
  it('returns the fix rule unchanged', () => {
    const rule = defineFixRule({
      id: 'test.fix-trailing',
      severity: 'warning',
      find: '\\s+$',
      replace: '',
      globs: ['**/*'],
      message: 'strip trailing whitespace',
    });
    expect(rule.id).toBe('test.fix-trailing');
    expect(rule.find).toBe('\\s+$');
    expect(rule.replace).toBe('');
  });

  it('freezes the fix rule object', () => {
    const rule = defineFixRule({
      id: 'test.frozen-fix',
      severity: 'warning',
      find: 'a',
      replace: 'b',
      globs: ['**/*'],
      message: 'm',
    });
    expect(Object.isFrozen(rule)).toBe(true);
  });

  it('allows all:true to apply to every match', () => {
    const rule = defineFixRule({
      id: 'test.all',
      severity: 'warning',
      find: 'x',
      replace: 'y',
      all: true,
      globs: ['**/*'],
      message: 'm',
    });
    expect(rule.all).toBe(true);
  });

  it('supports dependsOn for ordering with detect rules', () => {
    const rule = defineFixRule({
      id: 'test.ordered',
      severity: 'warning',
      find: 'a',
      replace: 'b',
      globs: ['**/*'],
      message: 'm',
      dependsOn: ['some-detect-rule'],
    });
    expect(rule.dependsOn).toEqual(['some-detect-rule']);
  });
});