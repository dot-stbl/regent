/**
 * L1: bundle resolution for `defineFormat` / `defineDelegate`
 * exports. A bundle like `@scope/regent-format-dotnet` exports a
 * `defineFormat` spec; `extends: '@scope/...' populates the
 * `formatSpecs` / `delegateSpecs` arrays in `LoaderRuleSet`.
 *
 * The bundle resolution path is symmetric to the detect-rule path
 * (`resolveExtendsNpmPackage`) — a single package can ship any
 * combination of detect rules, format specs, and delegate specs,
 * and the loader routes each export into the right pipeline.
 *
 * Tests use a real tmpdir + package.json + a tiny bundle module
 * written to disk so the dynamic-import path is exercised without
 * mocking the resolver. Vitest's in-memory TS transform would
 * skip the package.json lookup; we anchor the resolve via
 * `createRequire` against the loader module URL (see plugin-extends).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveExtendsBundle } from '../../src/loader/plugin-extends.js';

const DIR = join(tmpdir(), `regent-bundles-${Date.now()}`);
const BUNDLE_ROOT = join(DIR, 'node_modules', '@scope', 'regent-format-dotnet');
// `createRequire` anchors against a file URL — pass a sentinel
// `package.json` so resolution walks up from the sandbox dir.
const SENTINEL = join(DIR, 'package.json');

beforeAll(async () => {
  mkdirSync(BUNDLE_ROOT, { recursive: true });
  writeFileSync(SENTINEL, '{"name":"sandbox"}');

  // Minimal package.json — `name` + `main` + `type: module` so the
  // bundle is ESM. ESM avoids Node's CJS-default-wrap footgun (when
  // `module.exports = { default: ... }`, the dynamic `import()`
  // returns `mod.default.default` instead of `mod.default`). The
  // published bundles will mostly be ESM (TypeScript `defineFormat`
  // factories compile to ESM); CJS bundles are out of scope for the
  // first integration test.
  writeFileSync(
    join(BUNDLE_ROOT, 'package.json'),
    JSON.stringify({
      name: '@scope/regent-format-dotnet',
      version: '0.0.0-test',
      main: 'index.mjs',
      type: 'module',
    }),
  );

  // ESM default export — matches the convention the user sees when
  // they write `export default defineFormat({...})` in a `.ts`
  // bundle (TypeScript compiles to ESM by default in the regent
  // project's tsconfig — `module: "ESNext"`).
  writeFileSync(
    join(BUNDLE_ROOT, 'index.mjs'),
    `export default {
  id: 'dotnet.whitespace',
  severity: 'warning',
  params: { parse: (v) => v ?? {} },
  detect: () => ['dotnet', 'format', '.', '--verify-no-changes'],
  fix: () => ['dotnet', 'format', '.'],
  normalize: () => [],
};`,
  );
});

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('resolveExtendsBundle', () => {
  it('loads a default-exported format spec from an npm-shaped bundle', async () => {
    // `resolveFromFile` = SENTINEL anchors the createRequire lookup
    // at the sandbox `node_modules` (production callers omit it and
    // get the `import.meta.url` anchor). The argument MUST be a
    // file path (a sentinel package.json works) — createRequire
    // rejects bare directories.
    const bundle = await resolveExtendsBundle(
      '@scope/regent-format-dotnet',
      DIR,
      SENTINEL,
    );
    expect(bundle.formatSpecs).toHaveLength(1);
    expect(bundle.formatSpecs[0]!.id).toBe('dotnet.whitespace');
    expect(bundle.formatSpecs[0]!.source).toContain('@scope/regent-format-dotnet');
    expect(bundle.rules).toEqual([]);
    expect(bundle.delegateSpecs).toEqual([]);
  });

  it('returns empty arrays for an unknown package', async () => {
    // createRequire.resolve throws on miss — the resolver wraps
    // it in a clear error. For a bundle we don't import, the
    // promise should reject (not return empty), which is what
    // callers expect when a bundle isn't installed.
    await expect(
      resolveExtendsBundle('@scope/this-bundle-does-not-exist', DIR, SENTINEL),
    ).rejects.toThrow(/failed to load plugin/);
  });
});

describe('bundle dispatch (rule + format + delegate in one package)', () => {
  // The lookup walks every export and feeds each into the right
  // pipeline — confirm that a single bundle with three shapes
  // routes correctly. We mint a new bundle for this test (not
  // the one used above) so the assertions don't depend on a
  // specific export ordering.
  const MIX_ROOT = join(DIR, 'node_modules', '@scope', 'regent-mixed');

  beforeAll(() => {
    mkdirSync(MIX_ROOT, { recursive: true });
    writeFileSync(
      join(MIX_ROOT, 'package.json'),
      JSON.stringify({
        name: '@scope/regent-mixed',
        version: '0.0.0-test',
        main: 'index.mjs',
        type: 'module',
      }),
    );
    writeFileSync(
      join(MIX_ROOT, 'index.mjs'),
      `// One package, three shapes. Default → detect rule, named exports
// → format / delegate specs. The resolver walks each in order
// and routes by discriminator. Each spec carries the \`__kind\`
// marker that \`defineFormat\` / \`defineDelegate\` attach — that's
// the only way to disambiguate a delegate spec (no \`fix\` field)
// from a format spec that also omits \`fix\`.
export default {
  id: 'csharp.no-region',
  severity: 'error',
  pattern: '#region',
  globs: ['**/*.cs'],
  message: 'no #region',
};
export const formatSpec = {
  __kind: 'format',
  id: 'dotnet.whitespace',
  severity: 'warning',
  params: { parse: (v) => v ?? {} },
  detect: () => ['dotnet', 'format', '.'],
  normalize: () => [],
};
export const delegateSpec = {
  __kind: 'delegate',
  id: 'eslint.security',
  severity: 'error',
  params: { parse: (v) => v ?? {} },
  detect: () => ['eslint', '--format', 'json'],
  normalize: () => [],
};`,
    );
  });

  it('routes default / named exports to rules / formatSpecs / delegateSpecs', async () => {
    const bundle = await resolveExtendsBundle('@scope/regent-mixed', DIR, SENTINEL);
    expect(bundle.rules.map((r) => r.spec.id)).toEqual(['csharp.no-region']);
    expect(bundle.formatSpecs.map((s) => s.id)).toEqual(['dotnet.whitespace']);
    expect(bundle.delegateSpecs.map((s) => s.id)).toEqual(['eslint.security']);
  });
});
