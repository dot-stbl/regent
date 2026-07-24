/**
 * Update-check — compare the installed `regent` version against the
 * latest published on the npm registry. Surfaces a one-line warning
 * when a newer release exists, plus an explicit `regent update`
 * command for users who want to upgrade.
 *
 * Two surfaces:
 *   - `checkForUpdate()` — non-blocking, ~24h cache; called from
 *     `regent check` / `regent list` startup to print a single dim
 *     stderr line if outdated. Best-effort: any network error is
 *     swallowed silently (don't fail a run because npmjs is down).
 *   - `runUpdate()` — explicit command; prints the latest version,
 *     the upgrade command for the user's PM (npm / pnpm / yarn /
 *     bun), and exits non-zero if already up-to-date.
 *
 * Registry: hardcoded to `https://registry.npmjs.org/@dot-stbl/regent/latest`.
 * Override via `STBL_REGENT_REGISTRY` for internal/private mirrors.
 * Network timeout: 3s — anything longer and the user gets a worse
 * experience than a missed upgrade hint.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pc from 'picocolors';

const REGISTRY_URL_DEFAULT = 'https://registry.npmjs.org/@dot-stbl/regent/latest';
const TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedResult {
  readonly checkedAt: number;
  readonly latest: string;
}

interface UpdateInfo {
  readonly current: string;
  readonly latest: string;
  readonly upgradeAvailable: boolean;
}

let cache: CachedResult | null = null;
let cachePath: string | null = null;

function resolveCachePath(): string | null {
  if (cachePath !== null) {
    return cachePath;
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Walk up until we find a directory with a `package.json`
    // (the regent package root). That's where the cache file lives —
    // project-local `.gitignore` doesn't usually cover it, but the
    // file is small + harmless even if it leaks into a commit.
    let dir = here;
    for (let i = 0; i < 8; i++) {
      try {
        readFileSync(join(dir, 'package.json'));
        cachePath = join(dir, '.regent-update-cache.json');
        return cachePath;
      } catch {
        // not the package root — keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}

function readCache(): CachedResult | null {
  if (cache !== null) {
    return cache;
  }
  const path = resolveCachePath();
  if (path === null) {
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object'
      && parsed !== null
      && typeof (parsed as { checkedAt?: unknown }).checkedAt === 'number'
      && typeof (parsed as { latest?: unknown }).latest === 'string'
    ) {
      cache = parsed as CachedResult;
      return cache;
    }
  } catch {
    // ignore — corrupt or missing cache
  }
  return null;
}

function writeCache(latest: string): void {
  const path = resolveCachePath();
  if (path === null) {
    return;
  }
  try {
    const entry: CachedResult = { checkedAt: Date.now(), latest };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entry), 'utf8');
    cache = entry;
  } catch {
    // ignore — cache write failures are non-fatal
  }
}

/**
 * Compare two semver strings. Returns:
 *   -1 if `a < b`
 *    0 if `a == b`
 *    1 if `a > b`
 *
 * Handles `MAJOR.MINOR.PATCH` with optional `-prerelease`. We don't
 * pull in `semver` as a dep — three regexes cover the cases we
 * actually need (release builds + pre-release tags).
 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string): readonly [number, number, number, string] => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
    if (m === null) {
      return [0, 0, 0, ''];
    }
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ''];
  };
  const [a1, a2, a3, ap] = parse(a);
  const [b1, b2, b3, bp] = parse(b);
  if (a1 !== b1) return a1 < b1 ? -1 : 1;
  if (a2 !== b2) return a2 < b2 ? -1 : 1;
  if (a3 !== b3) return a3 < b3 ? -1 : 1;
  // Release > prerelease of the same triple: 0.4.1 > 0.4.1-rc.1.
  if (ap === bp) return 0;
  if (ap === '') return 1;
  if (bp === '') return -1;
  return ap < bp ? -1 : 1;
}

/**
 * Resolve the version of the currently-running regent. Reads the
 * `package.json` of the installed package by walking up from the
 * entry-point module. Falls back to the import-meta-url of this
 * module for monorepo / dev runs.
 */
function readInstalledVersion(): string {
  // Dev / monorepo path: the build emits dist/ alongside package.json
  // — `require('@dot-stbl/regent/package.json')` works when imported
  // as an npm package; for in-tree development we read the file
  // directly from this file's directory tree.
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: string };
    if (typeof pkg.version === 'string') {
      return pkg.version;
    }
  } catch {
    // fall through
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    let dir = here;
    for (let i = 0; i < 6; i++) {
      try {
        const raw = readFileSync(join(dir, 'package.json'), 'utf8');
        const pkg = JSON.parse(raw) as { version?: string };
        if (typeof pkg.version === 'string') {
          return pkg.version;
        }
      } catch {
        // continue walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // ignore
  }
  return '0.0.0';
}

/**
 * Fetch the latest published version from the npm registry.
 * Returns `null` on any failure (network, timeout, parse, schema).
 */
async function fetchLatestVersion(): Promise<string | null> {
  const url = process.env['STBL_REGENT_REGISTRY'] ?? REGISTRY_URL_DEFAULT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return null;
    }
    const body = await res.json() as { version?: unknown };
    if (typeof body.version !== 'string') {
      return null;
    }
    return body.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compute current vs latest. Cache hit returns immediately if fresh;
 * otherwise (or on cache miss) hits the network once.
 */
export async function getUpdateInfo(forceRefresh = false): Promise<UpdateInfo | null> {
  const current = readInstalledVersion();
  if (!forceRefresh) {
    const cached = readCache();
    if (cached !== null && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      return {
        current,
        latest: cached.latest,
        upgradeAvailable: compareSemver(current, cached.latest) < 0,
      };
    }
  }
  const latest = await fetchLatestVersion();
  if (latest === null) {
    return null;
  }
  writeCache(latest);
  return {
    current,
    latest,
    upgradeAvailable: compareSemver(current, latest) < 0,
  };
}

/**
 * Non-blocking version check for the startup warning path. Best-effort:
 * any failure returns `null` and the caller stays silent.
 *
 * Resets the cache when the user has explicitly opted out via
 * `STBL_REGENT_NO_UPDATE_CHECK=1` (CI / scripted runs).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (process.env['STBL_REGENT_NO_UPDATE_CHECK'] === '1') {
    return null;
  }
  return getUpdateInfo(false);
}

/**
 * Bounded variant — race the registry lookup against a hard timeout
 * so the caller can `await` it without risking a multi-second
 * startup stall. Used by `runCheck` / `runList` startup-warning
 * sites that need the warning to actually flush before the process
 * exits (fire-and-forget tends to lose the race against stdout's
 * final write).
 */
export async function checkForUpdateWithTimeout(timeoutMs: number): Promise<UpdateInfo | null> {
  if (process.env['STBL_REGENT_NO_UPDATE_CHECK'] === '1') {
    return null;
  }
  return Promise.race([
    getUpdateInfo(false),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

/**
 * Detect the user's package manager (npm / pnpm / yarn / bun) so the
 * `regent update` suggestion uses the right install command. Order of
 * preference (most-likely-correct first): bun, pnpm, yarn, npm.
 */
function detectPackageManager(): string {
  const ua = process.env['npm_config_user_agent'] ?? '';
  if (ua.startsWith('bun/')) return 'bun';
  if (ua.startsWith('pnpm/')) return 'pnpm';
  if (ua.startsWith('yarn/')) return 'yarn';
  if (ua.startsWith('npm/')) return 'npm';
  // Fallback: pick based on lockfile presence near cwd.
  const candidates: ReadonlyArray<readonly [string, string]> = [
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];
  for (const [lockfile, pm] of candidates) {
    try {
      readFileSync(join(process.cwd(), lockfile));
      return pm;
    } catch {
      // continue
    }
  }
  return 'npm';
}

function upgradeCommand(pm: string): string {
  switch (pm) {
    case 'bun':  return 'bun add -g @dot-stbl/regent@latest';
    case 'pnpm': return 'pnpm add -g @dot-stbl/regent@latest';
    case 'yarn': return 'yarn global add @dot-stbl/regent@latest';
    case 'npm':
    default:    return 'npm i -g @dot-stbl/regent@latest';
  }
}

/**
 * Format the one-line stderr warning emitted at startup when a
 * newer version is available. Styled with picocolors so it's visible
 * but unobtrusive in CI logs.
 */
export function formatUpdateWarning(info: UpdateInfo, useColor: boolean): string {
  const c = useColor ? pc : { dim: (s: string): string => s, cyan: (s: string): string => s, bold: (s: string): string => s };
  return [
    c.dim('update available:'),
    `${c.bold(info.current)} → ${c.cyan(info.latest)}`,
    c.dim(`(run \`regent update\` to upgrade)`),
  ].join(' ');
}

/**
 * Explicit `regent update` handler. Always prints, even when up-to-date.
 * Returns the process exit code (0 = up-to-date, 1 = error, 2 = newer available).
 */
export async function runUpdate(useColor: boolean): Promise<number> {
  const c = useColor ? pc : { dim: (s: string): string => s, cyan: (s: string): string => s, bold: (s: string): string => s, green: (s: string): string => s, yellow: (s: string): string => s, red: (s: string): string => s };
  const info = await getUpdateInfo(true);
  if (info === null) {
    process.stderr.write(`${c.red('regent:')} failed to reach the npm registry (${process.env['STBL_REGENT_REGISTRY'] ?? REGISTRY_URL_DEFAULT})\n`);
    process.stderr.write(`${c.dim('hint:')} check your network or set STBL_REGENT_REGISTRY=<mirror>\n`);
    return 1;
  }
  if (!info.upgradeAvailable) {
    process.stdout.write(`${c.green('✓')} regent ${info.current} is up to date (latest: ${info.latest})\n`);
    return 0;
  }
  const pm = detectPackageManager();
  const cmd = upgradeCommand(pm);
  process.stdout.write(`${c.yellow('!')} regent ${info.current} → ${c.cyan(info.latest)} available\n`);
  process.stdout.write(`${c.dim('package manager:')} ${pm}\n`);
  process.stdout.write(`${c.dim('upgrade:')}        ${c.bold(cmd)}\n`);
  return 2;
}
