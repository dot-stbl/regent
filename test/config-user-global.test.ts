/**
 * L0: user-global config (`~/.config/regent/config.json`).
 *
 * Covers the global layer of the merge pipeline — discovery, parse,
 * validation, missing-file fallback, and the `globalRulesPath`
 * threading into the loader.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadGlobalConfigLayer } from '../src/config/sources/file.js';
import { loadConfig } from '../src/config/index.js';

const HOME = join(tmpdir(), `regent-globalcfg-${Date.now()}`);

function clearLayoutEnv(): void {
  for (const key of [
    'STBL_REGENT_CONFIG_PATH',
    'STBL_REGENT_DATA_PATH',
    'STBL_REGENT_CACHE_PATH',
    'STBL_REGENT_STATE_PATH',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'XDG_STATE_HOME',
    'APPDATA',
    'LOCALAPPDATA',
    'STBL_REGENT_LOG_LEVEL',
    'STBL_REGENT_OUTPUT_COLOR',
  ]) {
    delete process.env[key];
  }
}

/**
 * Resolve the on-disk config dir used by `loadGlobalConfigLayer` for
 * the *current* host. The function under test calls
 * `resolveLayout()` (no args) which reads `process.env` and the live
 * `process.platform`. We mirror that here so tests write to the
 * right location regardless of where they run.
 */
function hostConfigDir(): string {
  if (osPlatform() === 'win32') {
    const appdata = process.env['APPDATA'] ?? join(HOME, 'Roaming');
    return join(appdata, 'regent');
  }
  const xdg = process.env['XDG_CONFIG_HOME'] ?? HOME;
  return join(xdg, 'regent');
}

beforeEach(() => {
  mkdirSync(HOME, { recursive: true });
  clearLayoutEnv();
  // Pin both XDG (Linux/macOS) and APPDATA (Windows) to HOME so the
  // resolved configDir lives under HOME on any host.
  process.env['XDG_CONFIG_HOME'] = HOME;
  process.env['XDG_DATA_HOME'] = join(HOME, 'data');
  process.env['XDG_CACHE_HOME'] = join(HOME, 'cache');
  process.env['XDG_STATE_HOME'] = join(HOME, 'state');
  process.env['APPDATA'] = join(HOME, 'Roaming');
  process.env['LOCALAPPDATA'] = join(HOME, 'Local');
});

afterEach(() => {
  clearLayoutEnv();
  rmSync(HOME, { recursive: true, force: true });
});

describe('loadGlobalConfigLayer', () => {
  it('returns null when config.json is missing (silent fallback)', async () => {
    const layer = await loadGlobalConfigLayer(HOME);
    expect(layer).toBeNull();
  });

  it('loads a bare config object from config.json', async () => {
    const configDir = hostConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ log: { level: 'debug' } }, null, 2),
    );

    const layer = await loadGlobalConfigLayer(HOME);
    expect(layer).not.toBeNull();
    expect(layer?.path).toBe(join(configDir, 'config.json'));
    expect(layer?.config.log.level).toBe('debug');
  });

  it('accepts a { regent: {...} } envelope', async () => {
    const configDir = hostConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ regent: { log: { format: 'json' } } }),
    );

    const layer = await loadGlobalConfigLayer(HOME);
    expect(layer?.config.log.format).toBe('json');
  });

  it('accepts a { config: {...} } envelope', async () => {
    const configDir = hostConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ config: { output: { color: false } } }),
    );

    const layer = await loadGlobalConfigLayer(HOME);
    expect(layer?.config.output.color).toBe(false);
  });

  it('threads globalRulesPath through the parsed config', async () => {
    const configDir = hostConfigDir();
    mkdirSync(configDir, { recursive: true });
    const customPath = join(HOME, 'my-rules');
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ globalRulesPath: customPath }),
    );

    const layer = await loadGlobalConfigLayer(HOME);
    expect(layer?.config.globalRulesPath).toBe(customPath);
  });

  it('throws on invalid JSON', async () => {
    const configDir = hostConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), '{ not valid json');

    await expect(loadGlobalConfigLayer(HOME)).rejects.toThrow(/config parse failed/);
  });

  it('throws on schema validation failure', async () => {
    const configDir = hostConfigDir();
    mkdirSync(configDir, { recursive: true });
    // log.level is enum-validated — 'loud' is not a valid level.
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ log: { level: 'loud' } }),
    );

    await expect(loadGlobalConfigLayer(HOME)).rejects.toThrow(/validation failed/);
  });

  it('honours STBL_REGENT_CONFIG_PATH (file-level override)', async () => {
    const altDir = join(HOME, 'alt-cfg');
    mkdirSync(altDir, { recursive: true });
    const altFile = join(altDir, 'my-config.json');
    writeFileSync(
      altFile,
      JSON.stringify({ log: { level: 'warn' } }),
    );
    process.env['STBL_REGENT_CONFIG_PATH'] = altFile;

    const layer = await loadGlobalConfigLayer(HOME);
    expect(layer?.path).toBe(altFile);
    expect(layer?.config.log.level).toBe('warn');
  });
});

describe('loadConfig — global layer precedence', () => {
  it('reports global layer as loaded when config.json is present', async () => {
    const configDir = hostConfigDir();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ log: { level: 'debug' } }),
    );

    const result = await loadConfig({ cwd: HOME });
    expect(result.sources.global).not.toBeNull();
    expect(result.config.log.level).toBe('debug');
  });

  it('reports global layer as not loaded when config.json is absent', async () => {
    const result = await loadConfig({ cwd: HOME });
    expect(result.sources.global).toBeNull();
    // Falls through to defaults.
    expect(result.config.log.level).toBe('info');
  });
});