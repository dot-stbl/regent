import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import pc from 'picocolors';

const CONFIG_FILES = [
  '.regentrc.ts', '.regentrc.js', '.regentrc.mjs', '.regentrc.cjs',
  '.regentrc.json', '.regentrc.yaml', '.regentrc.yml',
  'regent.config.ts', 'regent.config.js', 'regent.config.mjs', 'regent.config.cjs',
  'regent.config.json', 'regent.config.yaml', 'regent.config.yml',
  'tools/audit/config.ts',
] as const;

export function emitModuleTypeHint(cwd: string, useColor: boolean): void {
  if (process.env['STBL_REGENT_NO_MODULE_TYPE_CHECK'] === '1') return;

  let root = resolve(cwd);
  while (!CONFIG_FILES.some((name) => existsSync(join(root, name)))) {
    const packagePath = join(root, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
        if ('regent' in packageJson) break;
      } catch {
        return;
      }
    }
    const parent = dirname(root);
    if (parent === root) return;
    root = parent;
  }

  const packagePath = join(root, 'package.json');
  const rulesPath = join(root, 'tools', 'audit', 'rules');
  if (!existsSync(packagePath) || !existsSync(rulesPath)) return;

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { type?: unknown };
    const hasLintRules = readdirSync(rulesPath, { recursive: true, withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.endsWith('.lint.ts'));
    if (packageJson.type !== 'module' && hasLintRules) {
      const line = `regent: hint — add "type": "module" to ${packagePath} to silence the node MODULE_TYPELESS_PACKAGE_JSON warning for .lint.ts files`;
      process.stderr.write(`${useColor ? pc.dim(line) : line}\n`);
    }
  } catch {
    return;
  }
}
