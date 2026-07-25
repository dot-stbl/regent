import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CompiledAstRule } from '../src/kinds/ast.js';
import { loadRules } from '../src/loader.js';
import { renderHtml } from '../src/reporter/html.js';
import { renderJson } from '../src/reporter/json.js';
import { renderSarif } from '../src/reporter/sarif.js';
import { renderText } from '../src/reporter/text.js';
import { runRules } from '../src/runner.js';
import type { RunResult } from '../src/types.js';
const directory = join(tmpdir(), `regent-needs-native-${Date.now()}`);
const invalidDirectory = join(directory, 'invalid');
const globalDirectory = join(directory, 'global');
const originalGlobalPath = process.env['STBL_REGENT_GLOBAL_RULES_PATH'];
const cli = join(import.meta.dirname, '..', 'dist', 'cli.js');
const nativeRule: CompiledAstRule = {
  spec: {
    id: 'csharp.nullability.possible-dereference',
    language: 'missing-language-pack',
    severity: 'error',
    message: 'possible null dereference requires semantic analysis',
    globs: ['**/*.cs'],
    ast: { rule: { pattern: '$VALUE' } },
    needsNative: { tool: 'roslyn-analyzers', analyzer: 'CS8602' },
  },
  source: '<test>',
  origin: { kind: 'repo', path: directory },
};
let runResult: RunResult;
beforeAll(async () => {
  mkdirSync(invalidDirectory, { recursive: true });
  mkdirSync(globalDirectory, { recursive: true });
  writeFileSync(join(directory, 'Example.cs'), 'public sealed class Example;\n');
  writeFileSync(join(directory, 'Ignored.ts'), 'export class Ignored {}\n');
  writeFileSync(join(directory, '.regentrc.js'), `export default { rules: { ast: [{ id: '${nativeRule.spec.id}', language: 'csharp', severity: 'error', message: '${nativeRule.spec.message}', globs: ['**/*.cs'], ast: { rule: { pattern: '$VALUE' } }, needsNative: { tool: 'roslyn-analyzers', analyzer: 'CS8602' } }] } };`);
  writeFileSync(join(invalidDirectory, '.regentrc.js'), "export default { rules: { ast: [{ id: 'bad', language: 'csharp', severity: 'warning', message: 'bad', globs: ['**/*.cs'], ast: { rule: { pattern: '$VALUE' } }, needsNative: { tool: 'unknown-native-tool', analyzer: 'X001' } }] } };");
  process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = globalDirectory;
  runResult = await runRules(
    [],
    { cwd: directory, includeGlobs: ['**/*.{cs,ts}'], excludeGlobs: [], changedOnly: false, diffBase: 'HEAD' },
    { astRules: [nativeRule] },
  );
});
afterAll(() => {
  if (originalGlobalPath === undefined) delete process.env['STBL_REGENT_GLOBAL_RULES_PATH'];
  else process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = originalGlobalPath;
  rmSync(directory, { recursive: true, force: true });
});
describe('AST rules requiring native tools', () => {
  it('emits one delegation finding per matching file without parsing', () => {
    expect(runResult.findings).toHaveLength(1);
    expect(runResult.findings[0]).toMatchObject({
      ruleId: nativeRule.spec.id,
      status: 'native-tool-required',
      needsNative: nativeRule.spec.needsNative,
    });
  });

  it('renders native tool requirements in every output format', () => {
    const finding = runResult.findings[0]!;
    expect(renderJson([finding], [], { cwd: directory }).findings[0])
      .toMatchObject({ needsNative: nativeRule.spec.needsNative });
    const text = renderText([finding], { cwd: directory, useColor: false });
    expect(text).toContain('Native-tool delegation candidates'); expect(text).toContain('roslyn-analyzers/CS8602');
    const sarif = JSON.parse(renderSarif([finding], [], { cwd: directory }));
    expect(sarif.runs[0].results[0])
      .toMatchObject({ level: 'note', properties: { needsNative: nativeRule.spec.needsNative } });
    expect(renderHtml(runResult, { cwd: directory })).toContain('roslyn-analyzers/CS8602');
  });

  it('does not fail check when native tool findings are the only result', () => {
    const result = spawnSync(
      process.execPath,
      [cli, 'check', '--all', '--format', 'json', '--exit-on', 'suggestion'],
      { cwd: directory, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).findings[0].status).toBe('native-tool-required');
  });

  it('rejects unknown native tool ids at load time', async () => {
    await expect(loadRules({ repoRoot: invalidDirectory, skipLocal: true }))
      .rejects.toThrow("needsNative.tool 'unknown-native-tool' is not a known tool id");
  });
});
