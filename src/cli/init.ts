/**
 * `regent init --pre-commit` — install a git hook that runs
 * `regent check --diff` on staged files.
 *
 *   regent init --pre-commit             — auto-detect tool from
 *                                           packageManager field
 *   regent init --pre-commit --tool …    — explicit (husky|lefthook|none)
 *
 * Idempotent: re-running with the same tool is a no-op. Reads the
 * project's `.regentrc.*` / `regent.config.*` for rule selection.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REGENT_VERSION = '0.5.2';
const PRE_COMMIT_BANNER = 'regent pre-commit hook — see regent.config.* (or .regentrc.ts) for rules';
const PRE_COMMIT_DETAIL =
  'Runs `regent check --diff` on staged files. Bypass with `git commit --no-verify`.';

export type Tool = 'husky' | 'lefthook' | 'none';

export interface InitOptions {
  cwd?: string;
  /** Skip the tools/audit/ scaffold and install the pre-commit hook. */
  preCommit?: boolean;
  /** Override auto-detected hook tool. */
  tool?: Tool;
}

/**
 * Infer hook tool from `packageManager` field. Husky is the default for
 * npm + bun; lefthook for pnpm (faster cold installs). Returns `null`
 * when no package.json exists.
 */
export function detectPackageManager(packageJson: unknown): Tool | null {
  if (!packageJson || typeof packageJson !== 'object') return null;
  const pm = (packageJson as { packageManager?: string }).packageManager;
  if (typeof pm !== 'string') return null;
  if (pm.startsWith('pnpm')) return 'lefthook';
  return 'husky';
}

/** Add husky + lint-staged devDeps, prepare script, lint-staged config. Existing entries preserved. */
export function addHuskyToPackageJson(pkg: Record<string, unknown>): boolean {
  let modified = false;

  const scripts = (pkg['scripts'] ?? {}) as Record<string, string>;
  if (scripts['prepare'] !== 'husky') {
    scripts['prepare'] = 'husky';
    pkg['scripts'] = scripts;
    modified = true;
  }

  const devDeps = (pkg['devDependencies'] ?? {}) as Record<string, string>;
  if (devDeps['husky'] !== `^${REGENT_VERSION}`) {
    devDeps['husky'] = `^${REGENT_VERSION}`;
    modified = true;
  }
  if (devDeps['lint-staged'] !== `^${REGENT_VERSION}`) {
    devDeps['lint-staged'] = `^${REGENT_VERSION}`;
    modified = true;
  }
  pkg['devDependencies'] = devDeps;

  const lintStaged: Record<string, string | string[]> = {
    '*.cs': 'regent check --diff',
    '*.ts': 'regent check --diff',
    '*.tsx': 'regent check --diff',
    '*.rs': 'regent check --diff',
    '*.go': 'regent check --diff',
  };
  if (JSON.stringify(pkg['lint-staged'] ?? null) !== JSON.stringify(lintStaged)) {
    pkg['lint-staged'] = lintStaged;
    modified = true;
  }

  return modified;
}

/** Add lefthook to devDependencies (no script; lefthook reads .lefthook.yml). */
export function addLefthookToPackageJson(pkg: Record<string, unknown>): boolean {
  const devDeps = (pkg['devDependencies'] ?? {}) as Record<string, string>;
  if (devDeps['lefthook'] === `^${REGENT_VERSION}`) return false;
  devDeps['lefthook'] = `^${REGENT_VERSION}`;
  pkg['devDependencies'] = devDeps;
  return true;
}

/** Idempotent: write `.husky/pre-commit` only if its content differs. */
export function writeHuskyPreCommit(cwd: string): { written: boolean; path: string } {
  const dir = join(cwd, '.husky');
  const filePath = join(dir, 'pre-commit');
  const body = [
    '#!/usr/bin/env sh',
    `# ${PRE_COMMIT_BANNER}`,
    `# ${PRE_COMMIT_DETAIL}`,
    '',
    'npx --no-install lint-staged',
    '',
  ].join('\n');
  return writeIfChanged(dir, filePath, body);
}

/** Idempotent: write `.lefthook.yml` only if its content differs. */
export function writeLefthookConfig(cwd: string): { written: boolean; path: string } {
  const body = [
    '# ' + PRE_COMMIT_BANNER,
    '# ' + PRE_COMMIT_DETAIL,
    '',
    'pre-commit:',
    '  parallel: true',
    '  commands:',
    '    regent:',
    '      glob_filter:',
    '        - "*.cs"',
    '        - "*.ts"',
    '        - "*.tsx"',
    '        - "*.rs"',
    '        - "*.go"',
    '      run: npx --no-install regent check --diff',
    '',
  ].join('\n');
  return writeIfChanged(cwd, join(cwd, '.lefthook.yml'), body);
}

/** Print the bash snippet for users who chose `tool=none`. */
export function renderNoneHookScript(): string {
  return [
    '#!/usr/bin/env bash',
    `# ${PRE_COMMIT_BANNER}`,
    `# ${PRE_COMMIT_DETAIL}`,
    '# Paste into .git/hooks/pre-commit (chmod +x after).',
    '',
    'set -e',
    'npx --no-install regent check --diff',
    '',
  ].join('\n');
}

function writeIfChanged(
  dir: string,
  filePath: string,
  body: string,
): { written: boolean; path: string } {
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === body) {
    return { written: false, path: filePath };
  }
  if (dir !== filePath) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, body, 'utf8');
  return { written: true, path: filePath };
}

function readPackageJson(cwd: string): Record<string, unknown> | null {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try { return JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>; }
  catch { return null; }
}

function writePackageJson(cwd: string, pkg: Record<string, unknown>): boolean {
  const pkgPath = join(cwd, 'package.json');
  const next = `${JSON.stringify(pkg, null, 2)}\n`;
  const current = existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : '';
  if (current === next) return false;
  writeFileSync(pkgPath, next, 'utf8');
  return true;
}

/**
 * Entry point. Writes the hook files and mutates package.json when
 * relevant. Idempotent — running twice is a no-op.
 *
 *   runInit({ cwd, preCommit: true, tool: 'husky' | 'lefthook' | 'none' | undefined })
 *
 * Returns a human-readable summary block (for stdout) describing what
 * was added and how to bypass.
 */
export function runInitPreCommit(opts: InitOptions): string {
  const cwd = opts.cwd ?? process.cwd();
  const pkg = readPackageJson(cwd);
  const detected = detectPackageManager(pkg);
  const tool: Tool = opts.tool ?? detected ?? 'husky';

  const lines: string[] = [];
  lines.push(`regent init --pre-commit → tool=${tool} (${detected ? `detected ${detected}` : 'default'})`);

  if (tool === 'husky') {
    if (!pkg) {
      lines.push('  ⚠ no package.json in cwd — husky scaffold skipped');
    } else if (addHuskyToPackageJson(pkg)) {
      lines.push(`  ✓ ${join('package.json')}: devDependencies {husky, lint-staged}, scripts.prepare, lint-staged config`);
    } else {
      lines.push('  · package.json: husky already configured');
    }
    const hook = writeHuskyPreCommit(cwd);
    lines.push(hook.written
      ? `  ✓ ${hook.path}`
      : `  · ${hook.path}: already up to date`);
  } else if (tool === 'lefthook') {
    if (pkg && addLefthookToPackageJson(pkg)) {
      lines.push('  ✓ package.json: devDependencies.lefthook');
    } else if (pkg) {
      lines.push('  · package.json: lefthook already configured');
    } else {
      lines.push('  ⚠ no package.json in cwd — lefthook devDep skipped');
    }
    const cfg = writeLefthookConfig(cwd);
    lines.push(cfg.written
      ? `  ✓ ${cfg.path}`
      : `  · ${cfg.path}: already up to date`);
  } else {
    lines.push('  · tool=none: paste this into .git/hooks/pre-commit and chmod +x:');
    lines.push('');
    for (const line of renderNoneHookScript().split('\n')) {
      lines.push(`    ${line}`);
    }
  }

  if (pkg) writePackageJson(cwd, pkg);

  lines.push('');
  lines.push('Bypass with: git commit --no-verify');
  lines.push('Edit .regentrc.* (or regent.config.*) to add/remove rules.');
  return lines.join('\n');
}
