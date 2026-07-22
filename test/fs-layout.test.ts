/**
 * L0: XDG layout resolution — paths per OS + env overrides.
 *
 * The OS-specific defaults + env-var precedence are the issue #85
 * contract. We pin every cell of the matrix here so a future
 * reshuffle can't silently change paths.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import {
  detectPlatform,
  ensureLayout,
  resolveLayout,
  type RegentPlatform,
} from '../src/fs/layout.js';

const HOME = join(tmpdir(), 'regent-fs-home');

function clearLayoutEnv(): void {
  delete process.env['STBL_REGENT_CONFIG_PATH'];
  delete process.env['STBL_REGENT_DATA_PATH'];
  delete process.env['STBL_REGENT_CACHE_PATH'];
  delete process.env['STBL_REGENT_STATE_PATH'];
  delete process.env['XDG_CONFIG_HOME'];
  delete process.env['XDG_DATA_HOME'];
  delete process.env['XDG_CACHE_HOME'];
  delete process.env['XDG_STATE_HOME'];
  delete process.env['APPDATA'];
  delete process.env['LOCALAPPDATA'];
}

beforeEach(() => {
  mkdirSync(HOME, { recursive: true });
  clearLayoutEnv();
});

afterEach(() => {
  clearLayoutEnv();
  rmSync(HOME, { recursive: true, force: true });
});

describe('detectPlatform', () => {
  it('returns one of the three known platforms', () => {
    const p = detectPlatform();
    expect(['linux', 'macos', 'windows']).toContain(p);
  });
});

describe('resolveLayout — Linux defaults', () => {
  const linux: RegentPlatform = 'linux';

  it('uses XDG_CONFIG_HOME / XDG_DATA_HOME / XDG_CACHE_HOME / XDG_STATE_HOME when set', () => {
    const env = {
      XDG_CONFIG_HOME: join(HOME, 'cfg'),
      XDG_DATA_HOME: join(HOME, 'data'),
      XDG_CACHE_HOME: join(HOME, 'cache'),
      XDG_STATE_HOME: join(HOME, 'state'),
    };
    const layout = resolveLayout({ platform: linux, home: HOME, env });
    expect(layout.configDir).toBe(join(env.XDG_CONFIG_HOME, 'regent'));
    expect(layout.dataDir).toBe(join(env.XDG_DATA_HOME, 'regent'));
    expect(layout.cacheDir).toBe(join(env.XDG_CACHE_HOME, 'regent'));
    expect(layout.stateDir).toBe(join(env.XDG_STATE_HOME, 'regent'));
    expect(layout.logsDir).toBe(join(env.XDG_STATE_HOME, 'regent', 'logs'));
    expect(layout.configFile).toBe(join(env.XDG_CONFIG_HOME, 'regent', 'config.json'));
  });

  it('falls back to ~/.config / ~/.local/share / ~/.cache / ~/.local/state when XDG env unset', () => {
    const layout = resolveLayout({ platform: linux, home: HOME, env: {} });
    expect(layout.configDir).toBe(join(HOME, '.config', 'regent'));
    expect(layout.dataDir).toBe(join(HOME, '.local', 'share', 'regent'));
    expect(layout.cacheDir).toBe(join(HOME, '.cache', 'regent'));
    expect(layout.stateDir).toBe(join(HOME, '.local', 'state', 'regent'));
    expect(layout.logsDir).toBe(join(HOME, '.local', 'state', 'regent', 'logs'));
    expect(layout.configFile).toBe(join(HOME, '.config', 'regent', 'config.json'));
  });
});

describe('resolveLayout — macOS defaults', () => {
  const macos: RegentPlatform = 'macos';

  it('uses ~/.config / ~/.local/share / ~/.cache / ~/.local/state (matches issue table)', () => {
    const layout = resolveLayout({ platform: macos, home: HOME, env: {} });
    expect(layout.configDir).toBe(join(HOME, '.config', 'regent'));
    expect(layout.dataDir).toBe(join(HOME, '.local', 'share', 'regent'));
    expect(layout.cacheDir).toBe(join(HOME, '.cache', 'regent'));
    expect(layout.stateDir).toBe(join(HOME, '.local', 'state', 'regent'));
    expect(layout.logsDir).toBe(join(HOME, '.local', 'state', 'regent', 'logs'));
  });
});

describe('resolveLayout — Windows defaults', () => {
  const win: RegentPlatform = 'windows';

  it('uses %APPDATA% for config and %LOCALAPPDATA% for data/cache/state', () => {
    const env = {
      APPDATA: join(HOME, 'Roaming'),
      LOCALAPPDATA: join(HOME, 'Local'),
    };
    const layout = resolveLayout({ platform: win, home: HOME, env });
    expect(layout.configDir).toBe(join(env.APPDATA, 'regent'));
    expect(layout.dataDir).toBe(join(env.LOCALAPPDATA, 'regent', 'data'));
    expect(layout.cacheDir).toBe(join(env.LOCALAPPDATA, 'regent', 'cache'));
    expect(layout.stateDir).toBe(join(env.LOCALAPPDATA, 'regent', 'state'));
    expect(layout.logsDir).toBe(join(env.LOCALAPPDATA, 'regent', 'state', 'logs'));
    expect(layout.configFile).toBe(join(env.APPDATA, 'regent', 'config.json'));
  });

  it('falls back to ~/AppData/Roaming and ~/AppData/Local when APPDATA / LOCALAPPDATA unset', () => {
    const layout = resolveLayout({ platform: win, home: HOME, env: {} });
    expect(layout.configDir).toBe(join(HOME, 'AppData', 'Roaming', 'regent'));
    expect(layout.dataDir).toBe(join(HOME, 'AppData', 'Local', 'regent', 'data'));
  });
});

describe('resolveLayout — env-var overrides', () => {
  it('STBL_REGENT_DATA_PATH overrides dataDir', () => {
    const layout = resolveLayout({
      platform: 'linux',
      home: HOME,
      env: { STBL_REGENT_DATA_PATH: join(HOME, 'my-data') },
    });
    expect(layout.dataDir).toBe(join(HOME, 'my-data'));
  });

  it('STBL_REGENT_CACHE_PATH overrides cacheDir', () => {
    const layout = resolveLayout({
      platform: 'linux',
      home: HOME,
      env: { STBL_REGENT_CACHE_PATH: join(HOME, 'my-cache') },
    });
    expect(layout.cacheDir).toBe(join(HOME, 'my-cache'));
  });

  it('STBL_REGENT_STATE_PATH overrides stateDir + logsDir (logs derive from state)', () => {
    const layout = resolveLayout({
      platform: 'linux',
      home: HOME,
      env: { STBL_REGENT_STATE_PATH: join(HOME, 'my-state') },
    });
    expect(layout.stateDir).toBe(join(HOME, 'my-state'));
    expect(layout.logsDir).toBe(join(HOME, 'my-state', 'logs'));
  });

  it('STBL_REGENT_CONFIG_PATH points at the FILE (config.json) and derives configDir from dirname', () => {
    const layout = resolveLayout({
      platform: 'linux',
      home: HOME,
      env: { STBL_REGENT_CONFIG_PATH: join(HOME, 'alt', 'config.json') },
    });
    expect(layout.configFile).toBe(join(HOME, 'alt', 'config.json'));
    expect(layout.configDir).toBe(join(HOME, 'alt'));
  });

  it('all four overrides applied together', () => {
    const overrides = {
      configPath: join(HOME, 'c.json'),
      dataPath: join(HOME, 'd'),
      cachePath: join(HOME, 'c2'),
      statePath: join(HOME, 's'),
    };
    const layout = resolveLayout({
      platform: 'linux',
      home: HOME,
      env: {},
      overrides,
    });
    expect(layout.configFile).toBe(overrides.configPath);
    expect(layout.configDir).toBe(HOME); // dirname of c.json
    expect(layout.dataDir).toBe(overrides.dataPath);
    expect(layout.cacheDir).toBe(overrides.cachePath);
    expect(layout.stateDir).toBe(overrides.statePath);
    expect(layout.logsDir).toBe(join(overrides.statePath, 'logs'));
  });

  it('blank env var is treated as unset', () => {
    const layout = resolveLayout({
      platform: 'linux',
      home: HOME,
      env: { STBL_REGENT_DATA_PATH: '' },
    });
    expect(layout.dataDir).toBe(join(HOME, '.local', 'share', 'regent'));
  });

  it('overrides arg wins over env arg', () => {
    const layout = resolveLayout({
      platform: 'linux',
      home: HOME,
      env: { STBL_REGENT_DATA_PATH: join(HOME, 'env-data') },
      overrides: { dataPath: join(HOME, 'override-data') },
    });
    expect(layout.dataDir).toBe(join(HOME, 'override-data'));
  });
});

describe('ensureLayout', () => {
  it('creates all 5 dirs when missing (Linux)', () => {
    const layout = resolveLayout({ platform: 'linux', home: HOME, env: {} });
    ensureLayout(layout, { platform: 'linux' });
    expect(existsSync(layout.configDir)).toBe(true);
    expect(existsSync(layout.dataDir)).toBe(true);
    expect(existsSync(layout.cacheDir)).toBe(true);
    expect(existsSync(layout.stateDir)).toBe(true);
    expect(existsSync(layout.logsDir)).toBe(true);
  });

  it('creates all 5 dirs when missing (Windows — mode bits ignored)', () => {
    const layout = resolveLayout({ platform: 'windows', home: HOME, env: {} });
    ensureLayout(layout, { platform: 'windows' });
    expect(existsSync(layout.configDir)).toBe(true);
    expect(existsSync(layout.dataDir)).toBe(true);
    expect(existsSync(layout.cacheDir)).toBe(true);
    expect(existsSync(layout.stateDir)).toBe(true);
    expect(existsSync(layout.logsDir)).toBe(true);
  });

  it('is idempotent (does not throw on re-run)', () => {
    const layout = resolveLayout({ platform: 'linux', home: HOME, env: {} });
    ensureLayout(layout, { platform: 'linux' });
    expect(() => ensureLayout(layout, { platform: 'linux' })).not.toThrow();
  });

  it('tightens pre-existing dirs to 0700 (Unix data/cache/state/logs)', () => {
    if (sep !== '/') {
      // chmod 0700 only meaningful on POSIX. Skip on Windows.
      return;
    }
    const layout = resolveLayout({ platform: 'linux', home: HOME, env: {} });
    // Pre-create dirs with loose 0o755 perms.
    mkdirSync(layout.dataDir, { recursive: true, mode: 0o755 });
    mkdirSync(layout.cacheDir, { recursive: true, mode: 0o755 });
    ensureLayout(layout, { platform: 'linux' });
    expect(statSync(layout.dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(layout.cacheDir).mode & 0o777).toBe(0o700);
    expect(statSync(layout.stateDir).mode & 0o777).toBe(0o700);
    expect(statSync(layout.logsDir).mode & 0o777).toBe(0o700);
  });
});