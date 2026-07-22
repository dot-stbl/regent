// User-global XDG layout — resolves the per-user directories where
// regent stores its config, data, cache, state, and logs.
//
// Mirrors the C# `filesystem-paths.md` rule (XDG on Linux/macOS,
// %APPDATA% / %LOCALAPPDATA% on Windows). The loader reads
// `config.json` from `configDir` at startup — missing file → silent
// fallback (default behavior preserved).
//
// Per-layer env vars (highest priority, for tests + sandboxed runs):
//
//   STBL_REGENT_CONFIG_PATH — absolute path to the config.json file
//   STBL_REGENT_DATA_PATH   — absolute path to the data dir
//   STBL_REGENT_CACHE_PATH  — absolute path to the cache dir
//   STBL_REGENT_STATE_PATH  — absolute path to the state dir
//
// `resolveLayout()` is pure — no I/O. Use `ensureLayout()` separately
// to create directories (idempotent, called by the CLI entry point).

import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { chmodSync, mkdirSync, statSync } from 'node:fs';

/**
 * Coarse-grained OS class. Anything that isn't darwin/win32 falls
 * into `linux` (which matches `process.platform` returning `'linux'`,
 * `'freebsd'`, etc. — regent doesn't ship OS-specific code, just
 * directory roots, so the distinction is binary Unix-vs-Windows).
 */
export type RegentPlatform = 'linux' | 'macos' | 'windows';

/**
 * Thin over `process.platform` so tests can inject a deterministic
 * platform without monkey-patching the global. Never throws — unknown
 * platforms default to `linux` (the XDG default).
 */
export function detectPlatform(): RegentPlatform {
  const p = platform();
  if (p === 'win32') {
    return 'windows';
  }
  if (p === 'darwin') {
    return 'macos';
  }
  return 'linux';
}

/** Resolved user-global layout — every path is absolute. */
export interface RegentLayout {
  /** Config directory (e.g. `~/.config/regent` or `%APPDATA%\regent`). */
  readonly configDir: string;
  /** The config.json file regent reads at startup. */
  readonly configFile: string;
  /** Data directory (e.g. `~/.local/share/regent`). */
  readonly dataDir: string;
  /** Cache directory (e.g. `~/.cache/regent`). */
  readonly cacheDir: string;
  /** State directory (e.g. `~/.local/state/regent`). */
  readonly stateDir: string;
  /** Logs directory (`<stateDir>/logs`). */
  readonly logsDir: string;
}

/** Optional env override for one or more layers. */
export interface LayoutOverrides {
  readonly configPath?: string;
  readonly dataPath?: string;
  readonly cachePath?: string;
  readonly statePath?: string;
}

/** All injectable inputs to `resolveLayout()` — used by tests. */
export interface ResolveLayoutOptions {
  readonly platform?: RegentPlatform;
  readonly home?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly overrides?: LayoutOverrides;
}

const UNIX_DATA_MODE = 0o700;
const UNIX_CONFIG_MODE = 0o755;

/**
 * Resolve the user-global layout. Pure — no filesystem I/O. The CLI
 * calls `ensureLayout()` separately so failures there don't crash
 * the run; the loader only reads `configFile` and tolerates its
 * absence.
 *
 * Layered resolution: env override > XDG/SpecialFolder default. A
 * blank override is treated as unset (defensive against shells that
 * export `STBL_REGENT_DATA_PATH=`).
 */
export function resolveLayout(opts: ResolveLayoutOptions = {}): RegentLayout {
  const plat = opts.platform ?? detectPlatform();
  const env = opts.env ?? (process.env as Readonly<Record<string, string | undefined>>);
  const overrides = opts.overrides ?? {};
  const home = opts.home ?? homedir();

  let configDir: string;
  let dataDir: string;
  let cacheDir: string;
  let stateDir: string;

  if (plat === 'windows') {
    const appdata = env['APPDATA'] ?? join(home, 'AppData', 'Roaming');
    const localAppdata = env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');
    configDir = join(appdata, 'regent');
    dataDir = join(localAppdata, 'regent', 'data');
    cacheDir = join(localAppdata, 'regent', 'cache');
    stateDir = join(localAppdata, 'regent', 'state');
  } else {
    const xdgConfig = env['XDG_CONFIG_HOME'] ?? join(home, '.config');
    const xdgData = env['XDG_DATA_HOME'] ?? join(home, '.local', 'share');
    const xdgCache = env['XDG_CACHE_HOME'] ?? join(home, '.cache');
    const xdgState = env['XDG_STATE_HOME'] ?? join(home, '.local', 'state');
    configDir = join(xdgConfig, 'regent');
    dataDir = join(xdgData, 'regent');
    cacheDir = join(xdgCache, 'regent');
    stateDir = join(xdgState, 'regent');
  }

  // Apply env-var overrides — per-layer env vars come from
  // `process.env` (preferred for production) but tests inject via
  // `opts.env` or `opts.overrides`. The `overrides` arg wins over
  // `env` so tests can pin both layers independently.
  const configPathOverride = overrides.configPath ?? nonEmpty(env['STBL_REGENT_CONFIG_PATH']);
  const dataPathOverride = overrides.dataPath ?? nonEmpty(env['STBL_REGENT_DATA_PATH']);
  const cachePathOverride = overrides.cachePath ?? nonEmpty(env['STBL_REGENT_CACHE_PATH']);
  const statePathOverride = overrides.statePath ?? nonEmpty(env['STBL_REGENT_STATE_PATH']);

  if (dataPathOverride !== undefined) {
    dataDir = dataPathOverride;
  }
  if (cachePathOverride !== undefined) {
    cacheDir = cachePathOverride;
  }
  if (statePathOverride !== undefined) {
    stateDir = statePathOverride;
  }

  // STBL_REGENT_CONFIG_PATH points at the FILE (config.json), not
  // the directory — matches cosmiconfig's `--config <file>` semantic.
  // When the override is set, the config dir is the parent of the
  // explicit file (so `ensureLayout` still creates a sensible parent).
  // When unset, the dir is the OS-derived default.
  const configFile = configPathOverride ?? join(configDir, 'config.json');
  const finalConfigDir = configPathOverride !== undefined
    ? dirname(configFile)
    : configDir;

  return {
    configDir: finalConfigDir,
    configFile,
    dataDir,
    cacheDir,
    stateDir,
    logsDir: join(stateDir, 'logs'),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return value;
}

/**
 * Idempotent directory creation. Config dir gets `0o755` (other
 * processes may read it); data / cache / state / logs get `0o700`
 * on Unix (multi-user boxes — cached state should not be world-
 * readable). Windows ignores the mode bit (ACLs inherit from parent).
 *
 * `chmod` is best-effort: a pre-existing dir with looser perms is
 * tightened. Failures (e.g. read-only FS) are swallowed so the
 * caller doesn't crash on first run with a stale layout.
 */
export function ensureLayout(
  layout: RegentLayout,
  opts: { platform?: RegentPlatform } = {},
): void {
  const plat = opts.platform ?? detectPlatform();
  const isUnix = plat === 'linux' || plat === 'macos';

  mkdirSafe(layout.configDir, isUnix ? UNIX_CONFIG_MODE : undefined);
  if (isUnix) {
    chmodSafe(layout.configDir, UNIX_CONFIG_MODE);
  }

  for (const dir of [layout.dataDir, layout.cacheDir, layout.stateDir, layout.logsDir]) {
    mkdirSafe(dir, isUnix ? UNIX_DATA_MODE : undefined);
    if (isUnix) {
      chmodSafe(dir, UNIX_DATA_MODE);
    }
  }
}

function mkdirSafe(path: string, mode: number | undefined): void {
  try {
    mkdirSync(path, { recursive: true, mode });
  } catch {
    // EEXIST (race) or EACCES (read-only FS) — best-effort.
  }
}

function chmodSafe(path: string, mode: number): void {
  try {
    const cur = statSync(path).mode & 0o777;
    if (cur !== mode) {
      chmodSync(path, mode);
    }
  } catch {
    // best-effort
  }
}