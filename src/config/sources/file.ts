// File source — cosmiconfig walks up from cwd looking for a regent
// config file. Discovery order: `.regentrc.{ts,js,mjs,cjs,json,yaml,yml}`
// plus a `regent` field in `package.json`.
//
// Multi-layer: a single project may have BOTH a global config
// (`~/.config/regent/config.json` for user-wide defaults) and a project
// config (`<repo>/.regentrc.*`). Both are loaded separately so they
// layer through the merge pipeline at distinct precedence levels.
//
// The global layer is JSON-only (`config.json`) — kept simple and
// editor-friendly. Project configs stay TS/JS via cosmiconfig.

import { readFile } from 'node:fs/promises';

import { cosmiconfig } from 'cosmiconfig';
import { load as parse, YAMLException } from 'js-yaml';

import { resolveLayout } from '../../fs/layout.js';
import { safeParseConfig } from '../schema.js';
import type { RegentConfig } from '../schema.js';

const MODULE_NAME = 'regent';

const fileExplorer = cosmiconfig(MODULE_NAME, {
  searchPlaces: [
    'package.json',
    `.regentrc.ts`,
    `.regentrc.js`,
    `.regentrc.mjs`,
    `.regentrc.cjs`,
    `.regentrc.json`,
    `.regentrc.yaml`,
    `.regentrc.yml`,
    `regent.config.ts`,
    `regent.config.js`,
    `regent.config.mjs`,
    `regent.config.cjs`,
    `regent.config.json`,
    `regent.config.yaml`,
    `regent.config.yml`,
  ],
  loaders: {
    noExt: loadJsLike,
    '.ts': loadJsLike,
    '.js': loadJsLike,
    '.mjs': loadJsLike,
    '.cjs': loadJsLike,
    '.json': loadJson,
    '.yaml': loadYamlLike,
    '.yml': loadYamlLike,
  },
  stopDir: process.cwd(),
  cache: false,
});

/**
 * Async loader used for ts/js/mjs/cjs files. We import the file via
 * dynamic import (Node ESM) and pull `default` or a named export.
 *
 * `noExt` is used for `.regentrc` without an extension; we treat it
 * as JS-like for now.
 */
async function loadJsLike(filepath: string): Promise<RegentConfig | null> {
  try {
    const url = new URL(`file://${filepath.replace(/\\/g, '/')}`).href;
    const mod = (await import(url)) as Record<string, unknown>;
    const candidate = mod['default'] ?? mod['config'] ?? mod[MODULE_NAME];
    if (candidate === undefined || candidate === null) {
      return null;
    }
    const result = safeParseConfig(candidate);
    if (!result.ok) {
      throw new Error(`config validation failed at ${filepath}: ${result.error}`);
    }
    return result.value;
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }
    throw err;
  }
}

async function loadJson(filepath: string): Promise<RegentConfig | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(filepath, 'utf8');
    const parsed = JSON.parse(text);
    const candidate = parsed[MODULE_NAME] ?? parsed['config'] ?? parsed;
    const result = safeParseConfig(candidate);
    if (!result.ok) {
      throw new Error(`config validation failed at ${filepath}: ${result.error}`);
    }
    return result.value;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function loadYamlLike(filepath: string): Promise<RegentConfig | null> {
  try {
    const text = await readFile(filepath, 'utf8');
    const parsed: unknown = parse(text);
    if (parsed === null || parsed === undefined) {
      return null;
    }
    const document =
      typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    const candidate = document?.[MODULE_NAME] ?? document?.['config'] ?? parsed;
    const result = safeParseConfig(candidate);
    if (!result.ok) {
      throw new Error(`Zod validation failed for YAML config at ${filepath}: ${result.error}`);
    }
    return result.value;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return null;
    }
    if (err instanceof YAMLException) {
      throw new Error(`YAML parse failed at ${filepath}: ${err.message}`, { cause: err });
    }
    throw err;
  }
}

/**
 * Provenance-aware result returned by the layer loaders that include
 * a file path. Callers that don't care about provenance should use the
 * `RegentConfig`-returning helpers (`loadProjectConfig`, `loadGlobalConfig`,
 * `loadLocalConfig`) directly.
 */
export interface LoadedConfigLayer {
  readonly config: RegentConfig;
  readonly path: string | null;
}

/**
 * Load the project config from the cwd. Walks up directories looking
 * for `.regentrc.*` / `package.json#regent`.
 */
export async function loadProjectConfig(cwd: string): Promise<RegentConfig | null> {
  const layer = await loadProjectConfigLayer(cwd);
  return layer?.config ?? null;
}

/**
 * Like `loadProjectConfig` but also returns the absolute file path
 * cosmiconfig resolved. Used by `loadConfig()` for per-layer provenance.
 */
export async function loadProjectConfigLayer(cwd: string): Promise<LoadedConfigLayer | null> {
  const result = await fileExplorer.search(cwd);
  if (!result || result.isEmpty) {
    return null;
  }
  // Pass through schema validation again — the loader may have been a
  // passthrough (e.g. when there's no custom loader for a ts file).
  const parsed = safeParseConfig(result.config);
  if (!parsed.ok) {
    throw new Error(`config validation failed at ${result.filepath}: ${parsed.error}`);
  }
  return { config: parsed.value, path: result.filepath };
}

/**
 * Load the user-global config: `<configDir>/config.json` per
 * `resolveLayout()`. JSON-only (TS stays project-local via
 * `.regentrc.ts`). Applied as a layer LOWER than the project config
 * — user-wide defaults that any project can override.
 */
export async function loadGlobalConfig(_cwd: string): Promise<RegentConfig | null> {
  const layer = await loadGlobalConfigLayer(_cwd);
  return layer?.config ?? null;
}

/**
 * Like `loadGlobalConfig` but also returns the absolute file path.
 */
export async function loadGlobalConfigLayer(_cwd: string): Promise<LoadedConfigLayer | null> {
  const layout = resolveLayout();
  let text: string;
  try {
    text = await readFile(layout.configFile, 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      // No config file → silent fallback. Default behavior preserved.
      return null;
    }
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `config parse failed at ${layout.configFile}: ${(err as Error).message}`,
      { cause: err },
    );
  }
  // config.json can be either the config object directly, or a
  // `{ "regent": {...} }` envelope (matches cosmiconfig's
  // `package.json#regent` convention). Take whichever is present.
  const candidate = (raw as Record<string, unknown>)['regent']
    ?? (raw as Record<string, unknown>)['config']
    ?? raw;
  const parsed = safeParseConfig(candidate);
  if (!parsed.ok) {
    throw new Error(
      `user-global config validation failed at ${layout.configFile}: ${parsed.error}`,
    );
  }
  return { config: parsed.value, path: layout.configFile };
}

/**
 * Load the per-developer (gitignored) config. Treated as a layer HIGHER
 * than the committed project config — devs can mute/silence rules
 * locally without changing committed config.
 */
export async function loadLocalConfig(cwd: string): Promise<RegentConfig | null> {
  const layer = await loadLocalConfigLayer(cwd);
  return layer?.config ?? null;
}

/**
 * Like `loadLocalConfig` but also returns the absolute file path.
 */
export async function loadLocalConfigLayer(cwd: string): Promise<LoadedConfigLayer | null> {
  // Same search semantics as project config — cosmiconfig finds the
  // nearest `.regentrc.local.*` (or `package.json#regent` with a local
  // flag, but for now we just look for `.regentrc.local.*`).
  const localExplorer = cosmiconfig(MODULE_NAME, {
    searchPlaces: [
      `.regentrc.local.ts`,
      `.regentrc.local.js`,
      `.regentrc.local.mjs`,
      `.regentrc.local.cjs`,
      `.regentrc.local.json`,
      `.regentrc.local.yaml`,
      `.regentrc.local.yml`,
    ],
    loaders: {
      '.ts': loadJsLike,
      '.js': loadJsLike,
      '.mjs': loadJsLike,
      '.cjs': loadJsLike,
      '.json': loadJson,
    },
    cache: false,
  });
  const result = await localExplorer.search(cwd);
  if (!result || result.isEmpty) {
    return null;
  }
  const parsed = safeParseConfig(result.config);
  if (!parsed.ok) {
    throw new Error(`local config validation failed at ${result.filepath}: ${parsed.error}`);
  }
  return { config: parsed.value, path: result.filepath };
}
