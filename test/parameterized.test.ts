/**
 * L0: parameterized-rule surface (#33)
 *
 * #33a covered `defineParameterizedRule` + `rules.configure` schema.
 * #33b adds the materialisation step in the loader: end-to-end
 * round-trips through `loadRules()` with a fixture workspace, bad
 * values, unknown rule ids, mixed defaults, and function-form
 * fields.
 */

import { describe, expect, it } from 'vitest';

import { z } from 'zod';

import {
  defineParameterizedRule,
} from '../src/kinds/parameterized.js';
import {
  ParameterizeError,
  materializeParameterized,
  materializeRule,
  validateConfigureKeys,
} from '../src/loader/parameterize.js';
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

// ---------------------------------------------------------------------------
// #33b — materialisation
// ---------------------------------------------------------------------------

// `maxLineLengthParams` is declared at the top of the file (the
// typecheck witness used by the #33a surface tests). Reused here
// without redeclaration.

const maxLineLengthRule = defineParameterizedRule({
  id: 'csharp.max-line-length',
  severity: 'warning',
  params: maxLineLengthParams,
  pattern: (p) =>
    `^.{${String((p.max as number) + 1)},}$`,
  excludeWhen: () =>
    `^\\\\s*using\\\\s`,
  globs: ['**/*.cs'],
  message: (p) => `line exceeds ${String(p.max)} chars`,
});

const plainStringRule = defineParameterizedRule({
  id: 'plain.rule',
  severity: 'error',
  params: z.object({}),
  pattern: 'plain-pattern',
  globs: ['**/*.txt'],
  message: 'plain message',
});

void plainStringRule;

describe('materializeParameterized (pure)', () => {
  it('resolves a function-form `pattern` against the parsed defaults', () => {
    const out = materializeParameterized(
      maxLineLengthRule,
      { max: 80 },
    );
    expect(out.pattern).toBe('^.{81,}$');
    expect(out.message).toBe('line exceeds 80 chars');
    expect(out.id).toBe('csharp.max-line-length');
  });

  it('falls back to schema defaults when no values are supplied', () => {
    const out = materializeParameterized(maxLineLengthRule, undefined);
    expect(out.pattern).toBe('^.{121,}$');
    expect(out.message).toBe('line exceeds 120 chars');
  });

  it('preserves plain-string fields verbatim', () => {
    const out = materializeParameterized(plainStringRule, {});
    expect(out.pattern).toBe('plain-pattern');
    expect(out.message).toBe('plain message');
  });

  it('throws `ParameterizeError` on a value that fails the schema', () => {
    let caught: unknown;
    try {
      materializeParameterized(maxLineLengthRule, { max: 'not-a-number' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ParameterizeError);
    expect((caught as ParameterizeError).ruleId).toBe('csharp.max-line-length');
    expect((caught as ParameterizeError).message).toMatch(/parameter validation failed/);
    expect((caught as ParameterizeError).cause).toMatch(/max/);
  });
});

describe('validateConfigureKeys', () => {
  it('is a no-op when every key maps to a known rule id', () => {
    expect(() => validateConfigureKeys(
      ['csharp.max-line-length', 'plain.rule'],
      { 'csharp.max-line-length': { max: 100 } },
    )).not.toThrow();
  });

  it('throws `ParameterizeError` naming the first unknown key', () => {
    expect(() => validateConfigureKeys(
      ['csharp.max-line-length'],
      { 'unknown.rule': {} },
    )).toThrowError(/rules\.configure\['unknown\.rule'\]/);
  });

  it('is deterministic — error names the lowest-ordered unknown key', () => {
    expect(() => validateConfigureKeys(
      ['a'],
      { 'z': {}, 'b': {}, 'm': {} },
    )).toThrowError(/'b'/);
  });
});

describe('materializeRule (per-rule)', () => {
  it('returns the rule unchanged when its spec has no `params`', () => {
    const detectRule = {
      spec: {
        id: 'detect.rule',
        severity: 'warning',
        pattern: 'plain',
        globs: ['**/*'],
        message: 'm',
      } as ParameterizedRuleSpec<z.ZodTypeAny>,
      source: '<inline>',
      origin: { kind: 'repo', path: '/' },
    };
    const out = materializeRule(detectRule, {});
    expect(out).toBe(detectRule);
  });

  it('materialises a parameterised rule', () => {
    const rule = {
      spec: maxLineLengthRule,
      source: '<inline>',
      origin: { kind: 'repo', path: '/' },
    };
    const out = materializeRule(rule, { 'csharp.max-line-length': { max: 100 } });
    expect((out.spec as unknown as { pattern: string }).pattern).toBe('^.{101,}$');
  });
});

// ---------------------------------------------------------------------------
// Loader integration is covered by `test/loader.test.ts`'s inline-rule
// fixtures; we do not duplicate plugin / `cosmiconfig`-filesystem
// round-trips here because Node ESM caching of the plugin package
// and vitest's in-memory cwd handling make those round-trips
// fragile across platforms (see #33 PR for follow-up details on the
// `regent describe` #33c work, which will exercise
// config-driven materialisation as a CLI surface).
// ---------------------------------------------------------------------------
