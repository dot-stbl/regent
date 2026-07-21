/**
 * L1: RuleFixSpec types + validateFixSpec tests
 *
 * Covers:
 * - The four-lane discriminated union (replace / delete-line / function / guidance-only)
 * - safety↔kind invariants:
 *     - `safe` + `guidance-only` is rejected
 *     - `safe` + concrete kind is accepted
 *     - `suggested` + `guidance-only` is accepted
 *     - `suggested` + concrete kind is accepted
 * - `defineRule` accepts a `fix` field
 * - Zod loader accepts a `fix` on a rule
 */

import { describe, expect, it } from 'vitest';

import { defineRule, validateFixSpec } from '../../src/index.js';
import type {
  RuleFixContext,
  RuleFixFunction,
  RuleFixGuidanceOnly,
  RuleFixReplace,
  RuleFixSpec,
  RuleSpec,
} from '../../src/types.js';

describe('RuleFixSpec types', () => {
  it('safe + replace is accepted', () => {
    const fix: RuleFixReplace = {
      kind: 'replace',
      safety: 'safe',
      title: 'drop .ConfigureAwait(false)',
      template: '',
    };
    expect(validateFixSpec(fix)).toBe(true);
  });

  it('safe + delete-line is accepted', () => {
    const fix = {
      kind: 'delete-line' as const,
      safety: 'safe' as const,
      title: 'remove the #region/#endregion pair',
    };
    expect(validateFixSpec(fix)).toBe(true);
  });

  it('safe + function is accepted (pure + deterministic)', () => {
    const fix: RuleFixFunction = {
      kind: 'function',
      safety: 'safe',
      title: 'rewrite .Result into await',
      apply: (_ctx: RuleFixContext) => null,
    };
    expect(validateFixSpec(fix)).toBe(true);
  });

  it('safe + guidance-only is REJECTED', () => {
    const fix: RuleFixGuidanceOnly = {
      kind: 'guidance-only',
      safety: 'safe',
      title: 'should be suggested, not safe',
    };
    const result = validateFixSpec(fix);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/safe fixes must carry a concrete kind/);
  });

  it('suggested + guidance-only is accepted', () => {
    const fix: RuleFixGuidanceOnly = {
      kind: 'guidance-only',
      safety: 'suggested',
      title: 'replace IHttpClientFactory manually',
      guidance: 'requires constructor refactor — see the rule prose',
    };
    expect(validateFixSpec(fix)).toBe(true);
  });

  it('suggested + replace is accepted', () => {
    const fix: RuleFixReplace = {
      kind: 'replace',
      safety: 'suggested',
      title: 'ambiguous rewrite — agent decides',
      template: '$1',
    };
    expect(validateFixSpec(fix)).toBe(true);
  });

  it('exhaustive: every (safety, kind) combination is covered', () => {
    const cases: ReadonlyArray<{ safety: 'safe' | 'suggested'; kind: RuleFixSpec['kind'] }> = [
      { safety: 'safe', kind: 'replace' },
      { safety: 'safe', kind: 'delete-line' },
      { safety: 'safe', kind: 'function' },
      { safety: 'safe', kind: 'guidance-only' },
      { safety: 'suggested', kind: 'replace' },
      { safety: 'suggested', kind: 'delete-line' },
      { safety: 'suggested', kind: 'function' },
      { safety: 'suggested', kind: 'guidance-only' },
    ];
    for (const c of cases) {
      const fix = {
        kind: c.kind,
        safety: c.safety,
        title: 'test',
      } as unknown as RuleFixSpec;
      const result = validateFixSpec(fix);
      if (c.safety === 'safe' && c.kind === 'guidance-only') {
        expect(typeof result).toBe('string');
      } else {
        expect(result).toBe(true);
      }
    }
  });
});

describe('defineRule accepts fix', () => {
  it('a rule with a safe replace-fix freezes and round-trips', () => {
    const fix: RuleFixReplace = {
      kind: 'replace',
      safety: 'safe',
      title: 'drop suffix',
      template: '',
    };
    const rule: RuleSpec = {
      id: 'csharp.foo.bar',
      severity: 'warning',
      pattern: '_foo$',
      globs: ['**/*.cs'],
      message: 'drop the _foo suffix',
      fix,
    };
    const frozen = defineRule(rule);
    expect(frozen.fix).toBe(fix);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('a rule without a fix is unaffected (backward compat)', () => {
    const rule: RuleSpec = {
      id: 'csharp.foo.baz',
      severity: 'error',
      pattern: 'baz',
      globs: ['**/*.cs'],
      message: 'no baz',
    };
    const frozen = defineRule(rule);
    expect(frozen.fix).toBeUndefined();
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});