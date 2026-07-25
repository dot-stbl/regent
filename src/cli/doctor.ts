#!/usr/bin/env -S node
// `regent doctor` — health check for a regent setup, modeled on
// `flutter doctor` / `pnpm doctor`. One command, no required flags,
// prints a checklist of green/yellow/red statuses with one-line
// remediation hints.
//
// Exit codes:
//   0  — all green, or green + yellow (warnings; non-fatal)
//   1  — at least one red (blocking issue)
//
// Each check is a pure function of the cwd + the process state —
// the runner assembles them in order, prints, and returns. Tests
// drive `check*` helpers in isolation; the CLI subcommand wires
// the `runDoctor` entry-point.

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pc from 'picocolors';

import { defaultCachePath } from '../core/cache.js';
import { loadConfig } from '../config/index.js';
import { loadRules } from '../loader.js';
import { getUpdateInfo } from './update.js';

/** Outcome of a single check. `na` means the check is not applicable
 *  in the current state (e.g. no `package.json` → skip the module-type
 *  check). `na` is reported but never affects the exit code. */
export type CheckStatus = 'green' | 'yellow' | 'red' | 'na';

export interface CheckResult {
  readonly status: CheckStatus;
  readonly message: string;
  /** Optional one-line remediation hint, printed dim on the next line. */
  readonly hint?: string;
}

/** A doctor run can run from the CLI (`runDoctor()`) or be driven by
 *  tests. `cwd` defaults to `process.cwd()`; `useColor` defaults to
 *  picocolors' autodetect; `network` defaults to `true` (set `false`
 *  in tests to skip the registry probe). */
export interface DoctorOptions {
  readonly cwd?: string;
  readonly useColor?: boolean;
  readonly network?: boolean;
}

/** Summary roll-up of a full run. Returned by `runDoctorReport`
 *  for tests; the CLI subcommand prints the human-readable form. */
export interface DoctorReport {
  readonly checks: ReadonlyArray<readonly [string, CheckResult]>;
  readonly summary: { green: number; yellow: number; red: number; na: number };
}

const CONFIG_FILES = [
  '.regentrc.ts', '.regentrc.js', '.regentrc.mjs', '.regentrc.cjs',
  '.regentrc.json', '.regentrc.yaml', '.regentrc.yml',
  'regent.config.ts', 'regent.config.js', 'regent.config.mjs', 'regent.config.cjs',
  'regent.config.json', 'regent.config.yaml', 'regent.config.yml',
  'tools/audit/config.ts',
] as const;

/** Compute the symbol + colour for a status. Centralised so the
 *  printer and the tests share one source of truth. */
export function statusSymbol(status: CheckStatus, useColor: boolean): string {
  switch (status) {
    case 'green':
      return useColor ? pc.green('✓') : '✓';
    case 'yellow':
      return useColor ? pc.yellow('!') : '!';
    case 'red':
      return useColor ? pc.red('✗') : '✗';
    case 'na':
      return useColor ? pc.dim('-') : '-';
  }
}

// ---------- individual checks ----------

/** 1. Node.js major version. Green ≥ 20, yellow ≥ 18, red < 18. */
export function checkNodeVersion(raw: string = process.versions.node): CheckResult {
  const major = Number.parseInt(raw.split('.')[0] ?? '0', 10);
  if (Number.isNaN(major)) {
    return {
      status: 'red',
      message: `unknown version "${raw}"`,
      hint: 'node reported a malformed version; reinstall node',
    };
  }
  if (major >= 20) {
    return { status: 'green', message: `${raw} (>= 20)` };
  }
  if (major >= 18) {
    return {
      status: 'yellow',
      message: `${raw} (>= 18, < 20)`,
      hint: 'regent prefers node 20+; upgrade to silence this warning',
    };
  }
  return {
    status: 'red',
    message: `${raw} (< 18)`,
    hint: 'regent requires node 18+; upgrade immediately',
  };
}

/** 2. Config file presence — `.regentrc.*` / `regent.config.*` /
 *  `tools/audit/config.ts` (legacy v0.1). */
export function checkConfigFile(cwd: string): CheckResult {
  for (const name of CONFIG_FILES) {
    const path = join(cwd, name);
    if (existsSync(path)) {
      return { status: 'green', message: `${name} found at ${path}` };
    }
  }
  return {
    status: 'red',
    message: 'no .regentrc.*, regent.config.*, or tools/audit/config.ts found',
    hint: 'run `regent init` to scaffold a starter config, or `regent migrate` to upgrade a legacy config',
  };
}

/** 3. Config parses — drives both `loadConfig` (which catches Zod
 *  validation errors as `warnings` and degrades gracefully) and
 *  `loadRules` (which surfaces the count that `regent check` /
 *  `regent list` will report). Red when either path reports a
 *  failure; the first warning is surfaced as the remediation hint.
 *
 *  Special case: when a project has a `tools/audit/config.ts` or
 *  `.regentrc.*` (verified by `checkConfigFile`) and the only warning
 *  is about `package.json` being a false-positive match for
 *  cosmiconfig, we ignore that warning — the user's real config
 *  is the non-`package.json` file. Without this, a project that
 *  uses the v0.1 `tools/audit/config.ts` layout would always show
 *  a spurious red here. */
export async function checkConfigParses(cwd: string): Promise<CheckResult> {
  let configResult: Awaited<ReturnType<typeof loadConfig>>;
  try {
    configResult = await loadConfig({ cwd });
  } catch (err) {
    return {
      status: 'red',
      message: 'config failed to load',
      hint: (err as Error).message,
    };
  }
  // If a non-package.json config is present, drop the package.json
  // false-positive. The check is heuristic: the warning is package.json
  // when it mentions `package.json` AND no other file-based config was
  // found (i.e. project layer not loaded but a file from CONFIG_FILES
  // exists in cwd).
  const projectLayer = configResult.layers.find((l) => l.id === 'project');
  const realConfigPresent = CONFIG_FILES.some((name) => existsSync(join(cwd, name)));
  const realWarnings = configResult.warnings.filter((w) => {
    if (projectLayer?.loaded === true) {
      return true;
    }
    if (realConfigPresent && /package\.json/.test(w)) {
      return false;
    }
    return true;
  });
  if (realWarnings.length > 0) {
    return {
      status: 'red',
      message: 'config produced warnings during load',
      hint: realWarnings.join('\n'),
    };
  }
  try {
    const loaded = await loadRules({ repoRoot: cwd, skipLocal: true });
    const count =
      loaded.rules.length
      + loaded.astRules.length
      + loaded.transformRules.length;
    const source = projectLayer?.path ? ` (${projectLayer.path})` : '';
    return { status: 'green', message: `${count} rule(s) loaded${source}` };
  } catch (err) {
    return {
      status: 'red',
      message: 'rules failed to load',
      hint: (err as Error).message,
    };
  }
}

/** 4. User-global rules path. Respects the `STBL_REGENT_GLOBAL_RULES_PATH`
 *  override (used by tests and sandboxed runs). */
export function checkUserGlobalRules(): CheckResult {
  const home = homedir();
  const userRoot =
    process.env['STBL_REGENT_GLOBAL_RULES_PATH']
    ?? join(home, '.agents', 'rules');
  if (!existsSync(userRoot)) {
    return {
      status: 'yellow',
      message: `${userRoot} not found`,
      hint: 'no user-global rules will be loaded — create the directory to enable shared house rules',
    };
  }
  let count = 0;
  try {
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(join(dir, entry.name));
        } else if (
          entry.isFile()
          && (entry.name.endsWith('.lint.ts') || entry.name.endsWith('.rule.ts'))
        ) {
          count++;
        }
      }
    };
    walk(userRoot);
  } catch (err) {
    return {
      status: 'yellow',
      message: `${userRoot} is not readable`,
      hint: (err as Error).message,
    };
  }
  return { status: 'green', message: `${userRoot} (${count} rule file(s))` };
}

/** 5. Project rules. `na` when no `tools/audit/rules/` directory
 *  exists (the project hasn't adopted file-based rules yet — that
 *  is not by itself a problem). */
export function checkProjectRules(cwd: string): CheckResult {
  const rulesDir = join(cwd, 'tools', 'audit', 'rules');
  if (!existsSync(rulesDir)) {
    return { status: 'na', message: 'no tools/audit/rules/ directory' };
  }
  let count = 0;
  try {
    for (const entry of readdirSync(rulesDir, { recursive: true, withFileTypes: true })) {
      if (
        entry.isFile()
        && (entry.name.endsWith('.lint.ts') || entry.name.endsWith('.rule.ts'))
      ) {
        count++;
      }
    }
  } catch (err) {
    return {
      status: 'yellow',
      message: `${rulesDir} is not readable`,
      hint: (err as Error).message,
    };
  }
  if (count === 0) {
    return {
      status: 'yellow',
      message: `no .lint.ts files in ${rulesDir}`,
      hint: 'copy an example with `regent example copy <lang> <rule-id>`',
    };
  }
  return { status: 'green', message: `${count} file(s) in ${rulesDir}` };
}

/** 6. Module type. `na` when there's no `package.json` OR no
 *  `.lint.ts` rules (the lint rules are what needs ESM). Yellow
 *  when the project has lint rules but no `"type": "module"`. */
export function checkModuleType(cwd: string): CheckResult {
  const packagePath = join(cwd, 'package.json');
  if (!existsSync(packagePath)) {
    return { status: 'na', message: 'no package.json' };
  }
  const rulesDir = join(cwd, 'tools', 'audit', 'rules');
  const hasLintRules = existsSync(rulesDir)
    && readdirSync(rulesDir, { recursive: true, withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.endsWith('.lint.ts'));
  if (!hasLintRules) {
    return { status: 'na', message: 'no .lint.ts rules — module type irrelevant' };
  }
  let pkg: { type?: unknown };
  try {
    pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { type?: unknown };
  } catch (err) {
    return {
      status: 'red',
      message: `package.json is invalid JSON`,
      hint: (err as Error).message,
    };
  }
  if (pkg.type === 'module') {
    return { status: 'green', message: `"type": "module" set in ${packagePath}` };
  }
  return {
    status: 'yellow',
    message: `"type": "module" missing from ${packagePath}`,
    hint: 'add it to silence node MODULE_TYPELESS_PACKAGE_JSON warnings for .lint.ts files',
  };
}

/** 7. Regent freshness — uses the same `getUpdateInfo` lookup as
 *  the startup warning. `na` when the registry is unreachable
 *  (network failure is a warning, not a hard error). */
export async function checkRegentVersion(): Promise<CheckResult> {
  if (process.env['STBL_REGENT_NO_UPDATE_CHECK'] === '1') {
    return { status: 'na', message: 'update check disabled (STBL_REGENT_NO_UPDATE_CHECK=1)' };
  }
  const info = await getUpdateInfo(false);
  if (info === null) {
    return {
      status: 'na',
      message: 'could not reach npm registry',
      hint: 'check your network or set STBL_REGENT_REGISTRY=<mirror>',
    };
  }
  if (!info.upgradeAvailable) {
    return { status: 'green', message: `${info.current} (latest)` };
  }
  return {
    status: 'yellow',
    message: `${info.current} → ${info.latest} available`,
    hint: 'run `regent update` to upgrade',
  };
}

/** 8. Cache size. `na` when no cache file yet. Red when > 50MB
 *  (corruption / runaway growth). */
export function checkCache(cwd: string): CheckResult {
  const cachePath = defaultCachePath(cwd);
  if (!existsSync(cachePath)) {
    return { status: 'na', message: 'no cache yet' };
  }
  let bytes: number;
  try {
    bytes = statSync(cachePath).size;
  } catch (err) {
    return {
      status: 'red',
      message: `${cachePath} is unreadable`,
      hint: (err as Error).message,
    };
  }
  const mb = bytes / (1024 * 1024);
  const formatted = mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes > 50 * 1024 * 1024) {
    return {
      status: 'red',
      message: `${formatted} at ${cachePath} (over 50 MB)`,
      hint: 'run `regent cache clear` to free space',
    };
  }
  if (bytes > 10 * 1024 * 1024) {
    return {
      status: 'yellow',
      message: `${formatted} at ${cachePath}`,
      hint: 'consider `regent cache clear` if size keeps growing',
    };
  }
  return { status: 'green', message: `${formatted} at ${cachePath}` };
}

/** 9. Network — registry reachability with a hard 1.5s timeout
 *  (matches the bounded call used by the startup-warning path).
 *  `na` when the caller opts out via `network: false`. */
export async function checkNetwork(network: boolean): Promise<CheckResult> {
  if (!network) {
    return { status: 'na', message: 'skipped (--no-network)' };
  }
  const url = process.env['STBL_REGENT_REGISTRY']
    ?? 'https://registry.npmjs.org/@dot-stbl/regent/latest';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return {
        status: 'yellow',
        message: `npm registry returned HTTP ${res.status}`,
        hint: 'check your network or set STBL_REGENT_REGISTRY=<mirror>',
      };
    }
    return { status: 'green', message: 'npm registry reachable' };
  } catch (err) {
    return {
      status: 'yellow',
      message: 'npm registry unreachable',
      hint: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- runner ----------

/** Build a structured report — one entry per check, in the order
 *  defined in the spec. Tests assert against this shape; the CLI
 *  printer uses it to render text. */
export async function runDoctorReport(options: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();
  const network = options.network ?? true;
  const checks: Array<readonly [string, CheckResult]> = [
    ['Node.js version', checkNodeVersion()],
    ['Config file', checkConfigFile(cwd)],
    ['Config parses', await checkConfigParses(cwd)],
    ['User-global rules', checkUserGlobalRules()],
    ['Project rules', checkProjectRules(cwd)],
    ['Module type', checkModuleType(cwd)],
    ['Regent version', await checkRegentVersion()],
    ['Cache', checkCache(cwd)],
    ['Network', await checkNetwork(network)],
  ];
  let green = 0, yellow = 0, red = 0, na = 0;
  for (const [, c] of checks) {
    if (c.status === 'green') green++;
    else if (c.status === 'yellow') yellow++;
    else if (c.status === 'red') red++;
    else na++;
  }
  return { checks, summary: { green, yellow, red, na } };
}

/** Format the report as the human-readable text the spec shows.
 *  Centralised so tests can assert the exact output shape. */
export function renderDoctor(report: DoctorReport, useColor: boolean): string {
  const lines: string[] = ['regent doctor — health check', ''];
  for (const [name, c] of report.checks) {
    const sym = statusSymbol(c.status, useColor);
    lines.push(`${sym} ${name}: ${c.message}`);
    if (c.hint) {
      const hint = useColor ? pc.dim(`    ${c.hint}`) : `    ${c.hint}`;
      lines.push(hint);
    }
  }
  const { green, yellow, red, na } = report.summary;
  const summary = `Result: ${green} green, ${yellow} yellow, ${red} red${na > 0 ? `, ${na} n/a` : ''}`;
  lines.push('');
  lines.push(useColor ? pc.bold(summary) : summary);
  return `${lines.join('\n')}\n`;
}

/** Top-level entry — runs the report, prints it, returns the exit
 *  code. Wired into the CLI subcommand. */
export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const useColor = options.useColor ?? pc.isColorSupported;
  const report = await runDoctorReport(options);
  process.stdout.write(renderDoctor(report, useColor));
  return report.summary.red > 0 ? 1 : 0;
}
