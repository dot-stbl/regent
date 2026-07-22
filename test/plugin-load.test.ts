/**
 * L0: loader — `extends: '@scope/name'` plugin resolution (#23)
 *
 * Validates the npm-package dispatch added to `resolveExtendsItem`
 * in src/loader.ts. The dynamic `import()` inside the loader runs
 * in the same module context as `loader.ts`, so Node resolves bare
 * specifiers against the project's `node_modules` — exactly what
 * happens when a downstream consumer ships `@scope/regent-rules-x`
 * alongside `@dot-stbl/regent`.
 *
 * The fixture creates a throw-away plugin package in a tempdir, then
 * `junction`s it into `<projectRoot>/node_modules/@scope/...` for
 * the duration of the test (cleanup in `afterAll`). The junction
 * makes the plugin discoverable via the standard Node ESM
 * resolution without touching `package.json`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRules } from '../src/loader.js';

const PLUGIN_NAME = '@scope/regent-rules-test';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
// vitest resolves CWD via config — fall back to process.cwd() so the
// test works whether vitest is invoked from `<repo>` or anywhere else.
const REGENT_ROOT = join(
  PROJECT_ROOT,
  '..',
);
const NODE_MODULES_SCOPE = join(REGENT_ROOT, 'node_modules', '@scope');

const PLUGIN_TMPDIR = join(tmpdir(), `regent-plugin-${Date.now()}`);
const PLUGIN_PACKAGE_ROOT = join(PLUGIN_TMPDIR, 'pkg');
const LINK_PATH = join(NODE_MODULES_SCOPE, 'regent-rules-test');

let createdLink = false;

beforeAll(() => {
  // 1. Materialise the fixture package.
  mkdirSync(PLUGIN_PACKAGE_ROOT, { recursive: true });
  writeFileSync(
    join(PLUGIN_PACKAGE_ROOT, 'package.json'),
    JSON.stringify(
      {
        name: PLUGIN_NAME,
        version: '0.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js' },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(PLUGIN_PACKAGE_ROOT, 'index.js'),
    `export default {
  id: 'plugin.loaded-rule',
  severity: 'error',
  pattern: 'plugin-marker',
  globs: ['**/*.cs'],
  message: 'plugin rule loaded',
};`,
  );

  // 2. Junction the package into the project's node_modules so
  // Node ESM resolution finds `@scope/regent-rules-test` from
  // loader.ts. `symlinkSync` with type `junction` is the Windows-
  // friendly variant (no admin required). Pre-clean an existing
  // link from a prior interrupted run (EEXIST).
  mkdirSync(NODE_MODULES_SCOPE, { recursive: true });
  if (existsSync(LINK_PATH)) {
    rmSync(LINK_PATH, { force: true });
  }
  symlinkSync(PLUGIN_PACKAGE_ROOT, LINK_PATH, 'junction');
  createdLink = true;
});

afterAll(() => {
  if (createdLink && existsSync(LINK_PATH)) {
    rmSync(LINK_PATH, { force: true });
    createdLink = false;
  }
  if (existsSync(PLUGIN_TMPDIR)) {
    rmSync(PLUGIN_TMPDIR, { recursive: true, force: true });
  }
});

function consumerWorkspace(name: string, extendsSpec: string = PLUGIN_NAME): string {
  const dir = join(PLUGIN_TMPDIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, '.regentrc.js'),
    `export default {
  rules: { extends: ['${extendsSpec}'] },
};`,
  );
  writeFileSync(join(dir, 'sample.cs'), '// plugin-marker\n');
  return dir;
}

describe('resolveExtendsItem — npm package spec', () => {
  it('loads rules from `@scope/name` via dynamic import', async () => {
    const cwd = consumerWorkspace('consumer-success');
    // Avoid the project's cosmiconfig walk polluting the result —
    // the per-developer layer can pick up local settings.
    process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = join(PLUGIN_TMPDIR, 'empty-global');
    mkdirSync(process.env['STBL_REGENT_GLOBAL_RULES_PATH']!, { recursive: true });
    const result = await loadRules({ repoRoot: cwd, skipLocal: true });
    const ids = result.rules.map((r) => r.spec.id);
    expect(ids).toContain('plugin.loaded-rule');
    const pluginRule = result.rules.find((r) => r.spec.id === 'plugin.loaded-rule');
    expect(pluginRule?.spec.severity).toBe('error');
    expect(pluginRule?.origin.kind).toBe('repo');
  });

  it('records the source label so debug output points at the extends string', async () => {
    const cwd = consumerWorkspace('consumer-source');
    const result = await loadRules({ repoRoot: cwd, skipLocal: true });
    const pluginRule = result.rules.find((r) => r.spec.id === 'plugin.loaded-rule');
    expect(pluginRule?.source).toContain("'@scope/regent-rules-test'");
  });

  it('throws a clear error for an unknown `@scope/name`', async () => {
    const cwd = consumerWorkspace('consumer-missing', '@scope/regent-rules-does-not-exist');
    await expect(
      loadRules({ repoRoot: cwd, skipLocal: true }),
    ).rejects.toThrow(/failed to load plugin '@scope\/regent-rules-does-not-exist'/);
  });

  it('still rejects the legacy `@dot-stbl/regent/presets/...` prefix', async () => {
    const cwd = consumerWorkspace('consumer-preset', '@dot-stbl/regent/presets/csharp');
    await expect(
      loadRules({ repoRoot: cwd, skipLocal: true }),
    ).rejects.toThrow(/built-in presets are removed in v0\.2/);
  });
});
