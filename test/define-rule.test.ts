/**
 * L0: pure-unit test — defineRule + defineConfig
 * are immutable and preserve literal-type narrowing.
 */

import { describe, expect, it } from 'vitest';

import { defineConfig, defineRule } from '../src/define-rule.js';

describe('defineRule', () => {
  it('returns the rule unchanged', () => {
    const rule = defineRule({
      id: 'test.no-foo',
      severity: 'error',
      pattern: '\\bfoo\\b',
      globs: ['**/*.cs'],
      message: 'no foo',
    });
    expect(rule.id).toBe('test.no-foo');
  });

  it('freezes the rule object', () => {
    const rule = defineRule({
      id: 'test.frozen',
      severity: 'error',
      pattern: 'x',
      globs: ['**/*.cs'],
      message: 'm',
    });
    expect(Object.isFrozen(rule)).toBe(true);
  });
});

describe('defineConfig', () => {
  it('returns the config unchanged', () => {
    const cfg = defineConfig({
      extends: ['./local-rules.ts'],
      rules: { disable: [], override: {}, add: [] },
    });
    expect(cfg.extends).toHaveLength(1);
  });

  it('freezes the config object', () => {
    const cfg = defineConfig({ rules: {} });
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});
