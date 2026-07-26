/**
 * L0: `regent doctor` — health check for a regent setup (#6).
 *
 * Covers: individual `check*` helpers in isolation (parameterised
 * where useful), the full `runDoctorReport` summary counters, exit
 * code semantics, the rendered text shape. The e2e `npx regent
 * doctor` integration is exercised by `test/cli.test.ts` + the
 * captured output in the PR body.
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkBuildHookProject,
  checkCache,
  checkConfigFile,
  checkConfigParses,
  checkDotnetFormatExcludesSync,
  checkExcludesSingleSourceOfTruth,
  checkGofmtAvailable,
  checkModuleType,
  checkNetwork,
  checkNodeVersion,
  checkPrettierInstalled,
  checkProjectRules,
  checkRegentVersion,
  checkReSharperDotSettings,
  checkRustfmtConfig,
  checkTypeScriptConfig,
  checkUserGlobalRules,
  renderDoctor,
  runDoctor,
  runDoctorReport,
  statusSymbol,
} from '../src/cli/doctor.js';

let tmpRoot = '';

beforeEach(() => {
  tmpRoot = join(tmpdir(), `regent-doctor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  delete process.env['STBL_REGENT_GLOBAL_RULES_PATH'];
  delete process.env['STBL_REGENT_NO_UPDATE_CHECK'];
  delete process.env['STBL_REGENT_REGISTRY'];
});

// ---------- individual checks ----------

describe('checkNodeVersion', () => {
  it('is green on a 20+ release', () => {
    const c = checkNodeVersion('24.14.0');
    expect(c.status).toBe('green');
    expect(c.message).toBe('24.14.0 (>= 20)');
  });

  it('is yellow on a 18.x release', () => {
    const c = checkNodeVersion('18.20.5');
    expect(c.status).toBe('yellow');
    expect(c.message).toBe('18.20.5 (>= 18, < 20)');
    expect(c.hint).toContain('node 20');
  });

  it('is red on a sub-18 release', () => {
    const c = checkNodeVersion('16.20.0');
    expect(c.status).toBe('red');
    expect(c.message).toBe('16.20.0 (< 18)');
    expect(c.hint).toContain('18+');
  });

  it('is red on a malformed version string', () => {
    const c = checkNodeVersion('not-a-version');
    expect(c.status).toBe('red');
    expect(c.message).toContain('unknown version');
  });
});

describe('checkConfigFile', () => {
  it('is green when .regentrc.ts is present', () => {
    writeFileSync(join(tmpRoot, '.regentrc.ts'), 'export default {};');
    const c = checkConfigFile(tmpRoot);
    expect(c.status).toBe('green');
    expect(c.message).toContain('.regentrc.ts');
  });

  it('is green when only the legacy tools/audit/config.ts is present (v0.1 compat)', () => {
    mkdirSync(join(tmpRoot, 'tools', 'audit'), { recursive: true });
    writeFileSync(join(tmpRoot, 'tools', 'audit', 'config.ts'), 'export default {};');
    const c = checkConfigFile(tmpRoot);
    expect(c.status).toBe('green');
    expect(c.message).toContain('tools/audit/config.ts');
  });

  it('is red when no config exists', () => {
    const c = checkConfigFile(tmpRoot);
    expect(c.status).toBe('red');
    expect(c.hint).toContain('regent init');
  });
});

describe('checkConfigParses', () => {
  it('is green when a valid .regentrc.js is in cwd', async () => {
    writeFileSync(
      join(tmpRoot, '.regentrc.js'),
      `export default { rules: { detect: [], fix: [], extends: [], disable: [], override: {}, accept: [] } };`,
    );
    const c = await checkConfigParses(tmpRoot);
    expect(c.status).toBe('green');
    expect(c.message).toMatch(/0 rule\(s\) loaded/);
  });

  it('is red when the config file has invalid JS', async () => {
    writeFileSync(join(tmpRoot, '.regentrc.js'), 'this is not valid {{{');
    const c = await checkConfigParses(tmpRoot);
    expect(c.status).toBe('red');
    expect(c.hint).toBeTruthy();
  });
});

describe('checkUserGlobalRules', () => {
  it('is green when STBL_REGENT_GLOBAL_RULES_PATH points at a populated dir', () => {
    const root = join(tmpRoot, 'global');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'csharp.no-todo.lint.ts'), 'export default {};');
    writeFileSync(join(root, 'typescript.no-console.lint.ts'), 'export default {};');
    process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = root;
    const c = checkUserGlobalRules();
    expect(c.status).toBe('green');
    expect(c.message).toContain('2 rule file(s)');
  });

  it('is yellow when the global rules dir does not exist', () => {
    process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = join(tmpRoot, 'nope');
    const c = checkUserGlobalRules();
    expect(c.status).toBe('yellow');
    expect(c.hint).toContain('user-global rules');
  });
});

describe('checkProjectRules', () => {
  it('is na when tools/audit/rules/ is absent', () => {
    const c = checkProjectRules(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is yellow when the rules dir is empty', () => {
    mkdirSync(join(tmpRoot, 'tools', 'audit', 'rules'), { recursive: true });
    const c = checkProjectRules(tmpRoot);
    expect(c.status).toBe('yellow');
    expect(c.hint).toContain('example copy');
  });

  it('is green when .lint.ts files exist', () => {
    mkdirSync(join(tmpRoot, 'tools', 'audit', 'rules'), { recursive: true });
    writeFileSync(join(tmpRoot, 'tools', 'audit', 'rules', 'foo.lint.ts'), 'export default {};');
    writeFileSync(join(tmpRoot, 'tools', 'audit', 'rules', 'bar.lint.ts'), 'export default {};');
    const c = checkProjectRules(tmpRoot);
    expect(c.status).toBe('green');
    expect(c.message).toContain('2 file(s)');
  });
});

describe('checkModuleType', () => {
  it('is na when no package.json', () => {
    const c = checkModuleType(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is na when there are no .lint.ts rules (module type irrelevant)', () => {
    writeFileSync(join(tmpRoot, 'package.json'), '{}');
    mkdirSync(join(tmpRoot, 'tools', 'audit', 'rules'), { recursive: true });
    const c = checkModuleType(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is green when type=module and lint rules exist', () => {
    writeFileSync(join(tmpRoot, 'package.json'), '{"type":"module"}');
    mkdirSync(join(tmpRoot, 'tools', 'audit', 'rules'), { recursive: true });
    writeFileSync(join(tmpRoot, 'tools', 'audit', 'rules', 'foo.lint.ts'), 'export default {};');
    const c = checkModuleType(tmpRoot);
    expect(c.status).toBe('green');
    expect(c.message).toContain('"type": "module"');
  });

  it('is yellow when lint rules exist but type is not module', () => {
    writeFileSync(join(tmpRoot, 'package.json'), '{"name":"x"}');
    mkdirSync(join(tmpRoot, 'tools', 'audit', 'rules'), { recursive: true });
    writeFileSync(join(tmpRoot, 'tools', 'audit', 'rules', 'foo.lint.ts'), 'export default {};');
    const c = checkModuleType(tmpRoot);
    expect(c.status).toBe('yellow');
    expect(c.hint).toMatch(/module/i);
  });

  it('is red when package.json is invalid JSON', () => {
    writeFileSync(join(tmpRoot, 'package.json'), 'not json');
    mkdirSync(join(tmpRoot, 'tools', 'audit', 'rules'), { recursive: true });
    writeFileSync(join(tmpRoot, 'tools', 'audit', 'rules', 'foo.lint.ts'), 'export default {};');
    const c = checkModuleType(tmpRoot);
    expect(c.status).toBe('red');
  });
});

describe('checkRegentVersion', () => {
  it('returns na when STBL_REGENT_NO_UPDATE_CHECK=1', async () => {
    process.env['STBL_REGENT_NO_UPDATE_CHECK'] = '1';
    const c = await checkRegentVersion();
    expect(c.status).toBe('na');
    expect(c.message).toContain('disabled');
  });
});

describe('checkCache', () => {
  it('is na when no cache file exists', () => {
    const c = checkCache(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is green for a small cache file', () => {
    mkdirSync(join(tmpRoot, '.regent'), { recursive: true });
    writeFileSync(join(tmpRoot, '.regent', 'cache.json'), '{"x":1}');
    const c = checkCache(tmpRoot);
    expect(c.status).toBe('green');
    expect(c.message).toMatch(/(KB|MB) at/);
  });
});

describe('checkNetwork', () => {
  it('is na when network=false', async () => {
    const c = await checkNetwork(false);
    expect(c.status).toBe('na');
    expect(c.message).toContain('skipped');
  });
});

// ---------- language-aware tooling checks ----------

describe('checkDotnetFormatExcludesSync', () => {
  it('is na without a .sln marker', () => {
    const c = checkDotnetFormatExcludesSync(tmpRoot);
    expect(c.status).toBe('na');
    expect(c.message).toContain('.NET');
  });

  it('is green when the regent config has no excludes', () => {
    writeFileSync(join(tmpRoot, 'MyApp.sln'), '');
    writeFileSync(
      join(tmpRoot, '.regentrc.js'),
      `export default { rules: { detect: [], fix: [], extends: [], disable: [], override: {}, accept: [] } };`,
    );
    const c = checkDotnetFormatExcludesSync(tmpRoot);
    expect(c.status).toBe('green');
  });

  it('is yellow when regent excludes a path with no .editorconfig section (drift)', () => {
    writeFileSync(join(tmpRoot, 'MyApp.sln'), '');
    writeFileSync(
      join(tmpRoot, '.regentrc.js'),
      `export default { excludePaths: ['Migrations/**'], rules: { detect: [], fix: [], extends: [], disable: [], override: {}, accept: [] } };`,
    );
    // No .editorconfig at all → drift.
    const c = checkDotnetFormatExcludesSync(tmpRoot);
    expect(c.status).toBe('yellow');
    expect(c.message).toContain('Migrations/**');
    expect(c.hint).toContain('.editorconfig');
  });

  it('is green when both regent and .editorconfig carry the path', () => {
    writeFileSync(join(tmpRoot, 'MyApp.sln'), '');
    writeFileSync(
      join(tmpRoot, '.regentrc.js'),
      `export default { excludePaths: ['Migrations/**'], rules: { detect: [], fix: [], extends: [], disable: [], override: {}, accept: [] } };`,
    );
    writeFileSync(
      join(tmpRoot, '.editorconfig'),
      '[*.cs]\nindent_style = space\n\n[Migrations/**]\nindent_style = space\n',
    );
    const c = checkDotnetFormatExcludesSync(tmpRoot);
    expect(c.status).toBe('green');
  });
});

describe('checkReSharperDotSettings', () => {
  it('is na without a .sln marker', () => {
    const c = checkReSharperDotSettings(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is green when a DotSettings file is present', () => {
    writeFileSync(join(tmpRoot, 'MyApp.sln'), '');
    writeFileSync(join(tmpRoot, 'MyApp.sln.DotSettings'), '<wpf:ResourceDictionary />');
    const c = checkReSharperDotSettings(tmpRoot);
    expect(c.status).toBe('green');
    expect(c.message).toContain('DotSettings');
  });

  it('is yellow when the .sln exists but no DotSettings', () => {
    writeFileSync(join(tmpRoot, 'MyApp.sln'), '');
    const c = checkReSharperDotSettings(tmpRoot);
    expect(c.status).toBe('yellow');
    expect(c.hint).toContain('DotSettings');
  });
});

describe('checkBuildHookProject', () => {
  it('is na without a .sln marker', () => {
    const c = checkBuildHookProject(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is green when no Build.Tools.csproj is present', () => {
    writeFileSync(join(tmpRoot, 'MyApp.sln'), '');
    writeFileSync(join(tmpRoot, 'MyApp.Host.csproj'), '<Project />');
    const c = checkBuildHookProject(tmpRoot);
    expect(c.status).toBe('green');
  });

  it('is yellow when a legacy Build.Tools.csproj is still in tree', () => {
    writeFileSync(join(tmpRoot, 'MyApp.sln'), '');
    writeFileSync(join(tmpRoot, 'MyApp.Build.Tools.csproj'), '<Project />');
    const c = checkBuildHookProject(tmpRoot);
    expect(c.status).toBe('yellow');
    expect(c.message).toContain('Build.Tools.csproj');
  });
});

describe('checkPrettierInstalled', () => {
  it('is na without a package.json (no node project)', () => {
    const c = checkPrettierInstalled(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is green when prettier is in devDependencies', () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({ devDependencies: { prettier: '^3.0.0' } }),
    );
    const c = checkPrettierInstalled(tmpRoot);
    expect(c.status).toBe('green');
  });

  it('is red when a format script references prettier but the dep is missing', () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({ scripts: { format: 'prettier --write .' } }),
    );
    const c = checkPrettierInstalled(tmpRoot);
    expect(c.status).toBe('red');
    expect(c.message).toContain('prettier');
  });

  it('is yellow when a format script exists but no prettier is installed and no reference', () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({ scripts: { format: 'eslint --fix' } }),
    );
    const c = checkPrettierInstalled(tmpRoot);
    expect(c.status).toBe('yellow');
  });

  it('is na when no format/lint script is present (negative case from spec)', () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({ devDependencies: { eslint: '^9.0.0' } }),
    );
    const c = checkPrettierInstalled(tmpRoot);
    expect(c.status).toBe('na');
  });
});

describe('checkTypeScriptConfig', () => {
  it('is na without a package.json', () => {
    const c = checkTypeScriptConfig(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is green when tsconfig.json exists', () => {
    writeFileSync(join(tmpRoot, 'package.json'), '{}');
    writeFileSync(join(tmpRoot, 'tsconfig.json'), '{"include":["src"]}');
    const c = checkTypeScriptConfig(tmpRoot);
    expect(c.status).toBe('green');
  });

  it('is yellow when package.json exists but tsconfig.json does not', () => {
    writeFileSync(join(tmpRoot, 'package.json'), '{}');
    const c = checkTypeScriptConfig(tmpRoot);
    expect(c.status).toBe('yellow');
    expect(c.hint).toContain('tsconfig.json');
  });
});

describe('checkRustfmtConfig', () => {
  it('is na without a Cargo.toml', () => {
    const c = checkRustfmtConfig(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is green when rustfmt.toml exists', () => {
    writeFileSync(join(tmpRoot, 'Cargo.toml'), '[package]\nname = "x"');
    writeFileSync(join(tmpRoot, 'rustfmt.toml'), 'max_width = 100');
    const c = checkRustfmtConfig(tmpRoot);
    expect(c.status).toBe('green');
  });

  it('is green when Cargo.toml carries [workspace.metadata.rustfmt]', () => {
    writeFileSync(
      join(tmpRoot, 'Cargo.toml'),
      '[package]\nname = "x"\n\n[workspace.metadata.rustfmt]\nmax_width = 100\n',
    );
    const c = checkRustfmtConfig(tmpRoot);
    expect(c.status).toBe('green');
  });

  it('is yellow when no rustfmt config is present', () => {
    writeFileSync(join(tmpRoot, 'Cargo.toml'), '[package]\nname = "x"');
    const c = checkRustfmtConfig(tmpRoot);
    expect(c.status).toBe('yellow');
  });
});

describe('checkGofmtAvailable', () => {
  it('is na without a go.mod', () => {
    const c = checkGofmtAvailable(tmpRoot);
    expect(c.status).toBe('na');
  });

  it('is yellow when go.mod exists but gofmt is not on PATH', () => {
    writeFileSync(join(tmpRoot, 'go.mod'), 'module example.com/x\n\ngo 1.22\n');
    // Force `which gofmt` to fail: set PATH to an empty directory.
    const originalPath = process.env['PATH'];
    const originalPathExt = process.env['Path'];
    process.env['PATH'] = '';
    process.env['Path'] = '';
    try {
      const c = checkGofmtAvailable(tmpRoot);
      expect(c.status).toBe('yellow');
      expect(c.message).toContain('gofmt');
    } finally {
      process.env['PATH'] = originalPath;
      if (originalPathExt !== undefined) process.env['Path'] = originalPathExt;
      else delete process.env['Path'];
    }
  });
});

describe('checkExcludesSingleSourceOfTruth', () => {
  it('is na when fewer than two exclude sources exist', () => {
    writeFileSync(join(tmpRoot, '.regentrc.js'), 'export default {};');
    const c = checkExcludesSingleSourceOfTruth(tmpRoot);
    expect(c.status).toBe('na');
    expect(c.message).toContain('one exclude source');
  });

  it('is green when two sources share no paths (no drift to detect)', () => {
    writeFileSync(
      join(tmpRoot, '.regentrc.js'),
      `export default { excludePaths: ['**/bin/**'], rules: { detect: [], fix: [], extends: [], disable: [], override: {}, accept: [] } };`,
    );
    writeFileSync(
      join(tmpRoot, '.editorconfig'),
      '[*.cs]\nindent_style = space\n',
    );
    const c = checkExcludesSingleSourceOfTruth(tmpRoot);
    expect(c.status).toBe('green');
  });

  it('is yellow when a path appears in regent + .editorconfig but is missing from a third source', () => {
    writeFileSync(
      join(tmpRoot, '.regentrc.js'),
      `export default { excludePaths: ['Migrations/**'], rules: { detect: [], fix: [], extends: [], disable: [], override: {}, accept: [] } };`,
    );
    writeFileSync(
      join(tmpRoot, '.editorconfig'),
      '[*.cs]\nindent_style = space\n[Migrations/**]\nindent_style = space\n',
    );
    mkdirSync(join(tmpRoot, 'scripts'));
    // scripts/format.sh carries Generated/** but NOT Migrations/** —
    // so Migrations/** is in regent + .editorconfig (2 sources) but
    // missing from scripts/format.sh (the 3rd configured source) → drift.
    writeFileSync(
      join(tmpRoot, 'scripts', 'format.sh'),
      `#!/usr/bin/env bash\nEXCLUDE_PATHS=("Generated/**")\n`,
    );
    const c = checkExcludesSingleSourceOfTruth(tmpRoot);
    expect(c.status).toBe('yellow');
    expect(c.message).toMatch(/drift/i);
    expect(c.message).toContain('Migrations/**');
  });
});

// ---------- runner ----------

describe('statusSymbol', () => {
  it('uses the green check for green status', () => {
    expect(statusSymbol('green', false)).toBe('\u2713');
  });
  it('uses a bang for yellow status', () => {
    expect(statusSymbol('yellow', false)).toBe('!');
  });
  it('uses a cross for red status', () => {
    expect(statusSymbol('red', false)).toBe('\u2717');
  });
  it('uses a dash for na status', () => {
    expect(statusSymbol('na', false)).toBe('-');
  });
});

describe('renderDoctor', () => {
  it('emits a header, one line per check, and a summary footer', () => {
    const out = renderDoctor(
      {
        checks: [
          ['Node.js version', { status: 'green', message: '24.14.0 (>= 20)' }],
          ['Config file', { status: 'red', message: 'no config found', hint: 'run regent init' }],
        ],
        summary: { green: 1, yellow: 0, red: 1, na: 0 },
      },
      false,
    );
    expect(out).toContain('regent doctor \u2014 health check');
    expect(out).toContain('Node.js version: 24.14.0 (>= 20)');
    expect(out).toContain('Config file: no config found');
    expect(out).toContain('run regent init');
    expect(out).toContain('Result: 1 green, 0 yellow, 1 red');
  });
});

describe('runDoctorReport', () => {
  it('returns 17 checks in the documented order', async () => {
    const report = await runDoctorReport({ cwd: tmpRoot, network: false });
    const names = report.checks.map(([name]) => name);
    expect(names).toEqual([
      'Node.js version',
      'Config file',
      'Config parses',
      'User-global rules',
      'Project rules',
      'Module type',
      'Regent version',
      'Cache',
      'Network',
      'Dotnet format excludes',
      'ReSharper DotSettings',
      'Build-hook project',
      'Prettier installed',
      'TypeScript config',
      'Rustfmt config',
      'Gofmt available',
      'Excludes single source of truth',
    ]);
  });

  it('reports all-green summary for a synthetic fixture (with --no-network, regent-freshness skipped)', async () => {
    // The earlier version of this test asserted summary.red === 0 against
    // the live repo, which is a moving target (the repo doesn't ship a
    // committed regent config; the assertion relied on untracked local
    // setup that CI can't see). Use a deterministic fixture: every check
    // is set up to its green/na path so the summary counter is the only
    // thing under test. (User-global rules count and the developer's
    // $HOME are deliberately out of scope — see test/doctor.test.ts
    // §checkUserGlobalRules.)
    writeFileSync(
      join(tmpRoot, '.regentrc.js'),
      `export default { rules: { detect: [], fix: [], extends: [], disable: [], override: {}, accept: [] } };`,
    );
    mkdirSync(join(tmpRoot, 'tools', 'audit', 'rules'), { recursive: true });
    writeFileSync(join(tmpRoot, 'tools', 'audit', 'rules', 'foo.lint.ts'), 'export default {};');
    writeFileSync(join(tmpRoot, 'package.json'), '{"type":"module"}');
    const globalRoot = join(tmpRoot, 'global-rules');
    mkdirSync(globalRoot, { recursive: true });
    writeFileSync(join(globalRoot, 'csharp.no-todo.lint.ts'), 'export default {};');
    process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = globalRoot;
    process.env['STBL_REGENT_NO_UPDATE_CHECK'] = '1';

    const report = await runDoctorReport({ cwd: tmpRoot, network: false });

    expect(report.summary.red).toBe(0);
  });
});

describe('runDoctor exit codes', () => {
  it('returns 0 when no red is present', async () => {
    // Use a fully-empty tmpdir with no package.json + no config →
    // most checks become `na`, none become `red` for the curated
    // happy-path set we care about here. The "no config" check
    // would be red though, so we add an empty config.
    writeFileSync(join(tmpRoot, '.regentrc.js'), 'export default {};');
    writeFileSync(join(tmpRoot, 'package.json'), '{}');
    // Capture stdout so the test output isn't polluted.
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await runDoctor({ cwd: tmpRoot, network: false, useColor: false });
    stdout.mockRestore();
    expect(code).toBe(0);
  });

  it('returns 1 when any check is red', async () => {
    // No config file at all → checkConfigFile is red → exit 1.
    writeFileSync(join(tmpRoot, 'package.json'), '{}');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await runDoctor({ cwd: tmpRoot, network: false, useColor: false });
    stdout.mockRestore();
    expect(code).toBe(1);
  });
});
