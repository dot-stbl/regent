/**
 * L0: scope resolution helpers — `parseScopeNames`, `resolveScopes`,
 * `defaultScopes`. These are the core of the issue #35 monorepo
 * support: take a CLI `-s a,b` value + the merged config, return
 * the list of scopes to run.
 *
 * Coverage:
 *   - parseScopeNames: empty, single, comma-separated, whitespace,
 *     duplicates, empty entries (`,,` → throw)
 *   - resolveScopes: matches name, throws on unknown, absolute vs
 *     relative root resolution
 *   - defaultScopes: implicit single-project `default`, multi-scope
 *     declaration order
 */

import { describe, expect, it } from 'vitest';
import { resolve as resolvePath } from 'node:path';

import {
  parseScopeNames,
  resolveScopes,
  defaultScopes,
} from '../src/config/scopes.js';
import { defaultConfig } from '../src/config/sources/defaults.js';

// `resolve()` is OS-aware (it converts the cwd into a drive-letter
// path on Windows). Use it everywhere a test needs an expected
// "absolute" root so the assertions stay cross-platform.
const REPO = process.cwd();
const abs = (relative: string): string => resolvePath(REPO, relative);

describe('parseScopeNames', () => {
  it('returns an empty list for undefined', () => {
    expect(parseScopeNames(undefined)).toEqual([]);
  });

  it('returns an empty list for empty / whitespace string', () => {
    expect(parseScopeNames('')).toEqual([]);
    expect(parseScopeNames('   ')).toEqual([]);
  });

  it('splits a single name', () => {
    expect(parseScopeNames('frontend')).toEqual(['frontend']);
  });

  it('splits comma-separated names', () => {
    expect(parseScopeNames('frontend,backend')).toEqual(['frontend', 'backend']);
  });

  it('trims whitespace around each name', () => {
    expect(parseScopeNames(' frontend , backend ')).toEqual(['frontend', 'backend']);
  });

  it('deduplicates names (order preserved)', () => {
    expect(parseScopeNames('a,b,a,c,b')).toEqual(['a', 'b', 'c']);
  });

  it('throws on empty entries (`,,`)', () => {
    expect(() => parseScopeNames('frontend,,backend')).toThrow(/empty scope name/);
  });

  it('throws on trailing comma', () => {
    expect(() => parseScopeNames('frontend,')).toThrow(/empty scope name/);
  });
});

describe('resolveScopes', () => {
  const base = defaultConfig();

  it('returns an empty list for an empty name list', () => {
    expect(resolveScopes(base, [], REPO)).toEqual([]);
  });

  it('resolves a single declared scope to its absolute root', () => {
    const config = {
      ...base,
      scopes: { frontend: { root: 'apps/web' } },
    };
    const [scope] = resolveScopes(config, ['frontend'], REPO);
    expect(scope?.name).toBe('frontend');
    expect(scope?.root).toBe(abs('apps/web'));
    expect(scope?.relativeRoot).toBe('apps/web');
  });

  it('preserves the order of requested names', () => {
    const config = {
      ...base,
      scopes: { a: { root: 'a' }, b: { root: 'b' }, c: { root: 'c' } },
    };
    const scopes = resolveScopes(config, ['c', 'a', 'b'], REPO);
    expect(scopes.map((s) => s.name)).toEqual(['c', 'a', 'b']);
  });

  it('accepts absolute paths without resolving against cwd', () => {
    const config = {
      ...base,
      scopes: { shared: { root: abs('opt/shared') } },
    };
    const [scope] = resolveScopes(config, ['shared'], REPO);
    expect(scope?.root).toBe(abs('opt/shared'));
  });

  it('throws on an unknown scope name with a hint listing known scopes', () => {
    const config = {
      ...base,
      scopes: { frontend: { root: 'apps/web' } },
    };
    expect(() => resolveScopes(config, ['backend'], REPO)).toThrow(
      /unknown scope 'backend'.*frontend/s,
    );
  });

  it('throws with a "no scopes declared" hint when the config has none', () => {
    expect(() => resolveScopes(base, ['frontend'], REPO)).toThrow(
      /no scopes are declared/,
    );
  });
});

describe('defaultScopes', () => {
  it('returns one implicit `default` scope when no scopes are declared', () => {
    const [scope] = defaultScopes(defaultConfig(), REPO);
    expect(scope?.name).toBe('default');
    expect(scope?.root).toBe(REPO);
    expect(scope?.relativeRoot).toBe('.');
  });

  it('returns every declared scope in declaration order when scopes exist', () => {
    const config = {
      ...defaultConfig(),
      scopes: {
        frontend: { root: 'apps/web' },
        backend: { root: 'src' },
      },
    };
    const scopes = defaultScopes(config, REPO);
    expect(scopes.map((s) => s.name)).toEqual(['frontend', 'backend']);
    expect(scopes.map((s) => s.root)).toEqual([abs('apps/web'), abs('src')]);
  });

  it('preserves single declared scope (no implicit fallback)', () => {
    const config = {
      ...defaultConfig(),
      scopes: { only: { root: '.' } },
    };
    const [scope] = defaultScopes(config, REPO);
    expect(scope?.name).toBe('only');
    expect(scope?.root).toBe(REPO);
  });
});