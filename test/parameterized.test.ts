/**
 * L0: parameterized-rule surface (#33a)
 *
 * Validates the foundation surface only:
 * - `defineParameterizedRule` freezes and preserves the spec.
 * - `z.infer<typeof rule.params>` narrows `pattern`/`message`/
 *   `excludeWhen` function-typed fields (compile-time — each test
 *   that uses a function-typed field is a typecheck witness).
 * - The `configure` field on `RulesSectionSchema` accepts an empty
 *   object (default) and a per-id values map, and rejects invalid
 *   keys.
 *
 * Materialization (33b) and `regent describe` (33c) land later.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  defineParameterizedRule,
} from '../src/kinds/parameterized.js';
import {
  safeParseConfig,
} from '../src/config/schema.js';

const maxLineLengthParams = z.object({
  max: z.number().int().min(40).default(120),
});

describe('defineParameterizedRule', () => {
  it('freezes and preserves the spec object', () => {
    const rule = defineParameterizedRule({
      id: 'csharp.max-line-length',
      severity: 'warning',
      params: maxLineLengthParams,
      pattern: (p) => `^.{${String(p.max + 1)},}$`,
      globs: ['**/*.cs'],
      message: (p) => `line exceeds ${String(p.max)} chars`,
    });

    expect(Object.isFrozen(rule)).toBe(true);
    expect(rule.id).toBe('csharp.max-line-length');
    expect(rule.severity).toBe('warning');
    expect(rule.globs).toEqual(['**/*.cs']);
  });

  it('accepts a plain-string pattern + message (no params)', () => {
    const rule = defineParameterizedRule({
      id: 'plain.rule',
      severity: 'error',
      params: z.object({}),
      pattern: 'plain-pattern',
      globs: ['**/*.txt'],
      message: 'plain message',
    });

    expect(rule.pattern).toBe('plain-pattern');
    expect(rule.message).toBe('plain message');
  });

  it('preserves optional review/fix/rationale fields', () => {
    const rule = defineParameterizedRule({
      id: 'with-extras',
      severity: 'suggestion',
      params: z.object({}),
      pattern: 'x',
      globs: ['**/*'],
      message: 'm',
      rationale: 'why',
      source: 'rule.md#section',
    });

    expect(rule.rationale).toBe('why');
    expect(rule.source).toBe('rule.md#section');
  });

  it('narrows function-typed fields via `z.infer` (compile-time witness)', () => {
    // The shape of the parameter object (here `{ max: number }`)
    // is checked by TypeScript at compile time. A wrong property
    // access (`p.ma` instead of `p.max`) would fail typecheck.
    const rule = defineParameterizedRule({
      id: 'csharp.max-line-length-strict',
      severity: 'warning',
      params: maxLineLengthParams,
      pattern: (p) => `^.{${String(p.max + 1)},}$`,
      excludeWhen: (p) => `//.{0,${String(p.max)}}`,
      globs: ['**/*.cs'],
      message: (p) => `line exceeds ${String(p.max)} chars`,
    });
    expect(rule.id).toBe('csharp.max-line-length-strict');
  });
});

describe('RegentConfigSchema — rules.configure', () => {
  it('defaults to an empty object when omitted', () => {
    const result = safeParseConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rules.configure).toEqual({});
  });

  it('accepts per-rule values', () => {
    const result = safeParseConfig({
      rules: {
        configure: {
          'csharp.max-line-length': { max: 100 },
          'other.rule': {},
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rules.configure).toEqual({
      'csharp.max-line-length': { max: 100 },
      'other.rule': {},
    });
  });

  it('rejects unknown keys at the rules-section level (strict)', () => {
    const result = safeParseConfig({
      rules: {
        configure: { 'csharp.max': 42 },
        typos: ['definitely-not-a-field'],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/typos/);
  });

  it('rejects an empty-string rule id', () => {
    const result = safeParseConfig({
      rules: {
        configure: { '': { max: 100 } },
      },
    });
    expect(result.ok).toBe(false);
  });
});
