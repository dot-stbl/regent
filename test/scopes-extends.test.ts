/**
 * L0: scope inline `extends[]` plumbing (issue #105).
 *
 * `resolveScopeExtends` turns a `ScopeSpec.extends` array into a
 * synthetic `RegentConfig` whose `rules.extends` mirrors it. The
 * loader's existing `resolveExtendsItem` loop then resolves each
 * entry against `<scope.root>`. End-to-end coverage of the merge
 * splice lives in `test/cli-scopes.test.ts` (integration tests that
 * spawn the CLI with a real workspace).
 *
 * We do NOT call `loadScopeConfigLayer` here — that function triggers
 * cosmiconfig's upward walk from the test temp dir, which would hit
 * the stray `package.json` at the user's `%TEMP%` root and fail
 * validation. The integration tests exercise that path instead.
 *
 * Coverage:
 *   - `resolveScopeExtends` returns a valid RegentConfig with the
 *     extends mirrored verbatim.
 *   - `resolveScopeExtends([])` mirrors the Zod defaults elsewhere —
 *     all rule arrays empty, scopes `{}`, etc.
 */

import { describe, expect, it } from 'vitest';

import { resolveScopeExtends } from '../src/config/scope-loader.js';
import { defaultConfig } from '../src/config/sources/defaults.js';

describe('resolveScopeExtends (issue #105)', () => {
  it('returns a valid RegentConfig with an empty extends list by default', () => {
    const layer = resolveScopeExtends([]);
    expect(layer.rules.extends).toEqual([]);
    expect(layer.rules.detect).toEqual([]);
    expect(layer.scopes).toEqual({});
    expect(layer.excludePaths).toEqual([]);
  });

  it('mirrors a string entry verbatim onto rules.extends', () => {
    const layer = resolveScopeExtends(['./extra.lint.ts']);
    expect(layer.rules.extends).toEqual(['./extra.lint.ts']);
  });

  it('mirrors an inline rule array entry verbatim', () => {
    const inlineRule = {
      id: 'team.inline',
      severity: 'warning',
      pattern: '\\bTODO\\b',
      globs: ['**/*.ts'],
      message: 'no TODO',
    };
    const layer = resolveScopeExtends([[inlineRule]]);
    expect(layer.rules.extends).toEqual([[inlineRule]]);
  });

  it('mirrors a mixed list (paths, globs, inline arrays) in order', () => {
    const inlineRule = {
      id: 'inline',
      severity: 'error',
      pattern: 'x',
      globs: ['**/*'],
      message: 'm',
    };
    const layer = resolveScopeExtends([
      '@dot-stbl/regent-rules-foo',
      './apps/web/extra.lint.ts',
      'apps/web/**/*.lint.ts',
      [inlineRule],
    ]);
    expect(layer.rules.extends).toEqual([
      '@dot-stbl/regent-rules-foo',
      './apps/web/extra.lint.ts',
      'apps/web/**/*.lint.ts',
      [inlineRule],
    ]);
  });

  it('preserves the Zod default scalar fields (cache, log, output, runner)', () => {
    const layer = resolveScopeExtends([]);
    const defaults = defaultConfig();
    expect(layer.cache).toEqual(defaults.cache);
    expect(layer.log).toEqual(defaults.log);
    expect(layer.output).toEqual(defaults.output);
    expect(layer.runner).toEqual(defaults.runner);
  });
});