import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emitModuleTypeHint } from '../src/cli/module-type-check.js';

let projectRoot = '';

beforeEach(() => {
  projectRoot = join(tmpdir(), `regent-module-type-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(projectRoot, 'tools', 'audit', 'rules'), { recursive: true });
  writeFileSync(join(projectRoot, '.regentrc.js'), 'export default {};');
  writeFileSync(join(projectRoot, 'package.json'), '{}');
  writeFileSync(join(projectRoot, 'tools', 'audit', 'rules', 'foo.lint.ts'), 'export default {};');
  delete process.env['STBL_REGENT_NO_MODULE_TYPE_CHECK'];
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env['STBL_REGENT_NO_MODULE_TYPE_CHECK'];
});

describe('emitModuleTypeHint', () => {
  it('writes a one-line stderr hint when lint rules lack module package type', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    emitModuleTypeHint(projectRoot, false);

    expect(stderr).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledWith(
      `regent: hint — add "type": "module" to ${join(projectRoot, 'package.json')} to silence the node MODULE_TYPELESS_PACKAGE_JSON warning for .lint.ts files\n`,
    );
  });

  it('stays silent when package type is module', () => {
    writeFileSync(join(projectRoot, 'package.json'), '{"type":"module"}');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    emitModuleTypeHint(projectRoot, false);

    expect(stderr).not.toHaveBeenCalled();
  });

  it('respects the module type check opt-out', () => {
    process.env['STBL_REGENT_NO_MODULE_TYPE_CHECK'] = '1';
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    emitModuleTypeHint(projectRoot, false);

    expect(stderr).not.toHaveBeenCalled();
  });
});
