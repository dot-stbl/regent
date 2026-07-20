// Env source — reads `STBL_REGENT_*` env vars and `.env` (via dotenv),
// produces a partial config overlay.
//
// Mapping (env → config):
//
//   STBL_REGENT_LOG_LEVEL            → log.level
//   STBL_REGENT_LOG_FORMAT           → log.format
//   STBL_REGENT_CACHE_ENABLED        → cache.enabled
//   STBL_REGENT_CACHE_MAX_BYTES      → cache.maxBytes
//   STBL_REGENT_OUTPUT_COLOR         → output.color
//   STBL_REGENT_OUTPUT_CONTEXT_BUFFER → output.contextBuffer
//
// Bool parsing accepts: 'true' | 'false' | '1' | '0' | 'yes' | 'no'
// (case-insensitive). Unknown values throw at read time with a clear
// hint about which env var produced the bad value.
//
// `.env` is loaded by the caller (loadConfig) before reading process.env
// so user-set shell env still wins over `.env`. We don't import dotenv
// here — we just read whatever's in `process.env` at the time.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { safeParseConfig } from '../schema.js';
import type { RegentConfig } from '../schema.js';

const PREFIX = 'STBL_REGENT_';

const BOOL_TRUE = new Set(['true', '1', 'yes', 'on']);
const BOOL_FALSE = new Set(['false', '0', 'no', 'off']);

function parseBool(name: string, raw: string): boolean {
  const lower = raw.toLowerCase();
  if (BOOL_TRUE.has(lower)) {
    return true;
  }
  if (BOOL_FALSE.has(lower)) {
    return false;
  }
  throw new Error(
    `env ${name}: cannot parse '${raw}' as boolean — expected one of: true | false | 1 | 0 | yes | no | on | off (case-insensitive)`,
  );
}

function parseInt10(name: string, raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    throw new Error(`env ${name}: cannot parse '${raw}' as integer`);
  }
  return n;
}

/**
 * Read a single env var, returning `undefined` if not set or empty.
 * Validators run only when the var is present.
 */
function readEnv(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return undefined;
  }
  return v;
}

/**
 * Optionally load `.env` from cwd into process.env. Only sets keys
 * that aren't already present — explicit env wins.
 */
export function loadDotEnv(cwd: string): void {
  const dotenvPath = join(cwd, '.env');
  if (!existsSync(dotenvPath)) {
    return;
  }
  try {
    const text = readFileSync(dotenvPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const eq = line.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // Strip surrounding quotes (single or double).
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is best-effort; missing or unreadable is not fatal.
  }
}

/**
 * Build a partial `RegentConfig` from `STBL_REGENT_*` env vars.
 * Returns `null` when no relevant vars are set — caller treats as
 * "no layer to apply".
 *
 * Unknown keys prefixed with `STBL_REGENT_` but not in our mapping
 * are ignored silently (forward-compat — new vars don't break old
 * binaries). Validation of value formats is strict (bad bool/int
 * throws immediately so users see the failure at startup).
 */
export function buildEnvConfig(): RegentConfig | null {
  const env = process.env;

  const log: { level?: RegentConfig['log']['level']; format?: RegentConfig['log']['format'] } = {};
  if (readEnv(`${PREFIX}LOG_LEVEL`)) {
    log.level = readEnv(`${PREFIX}LOG_LEVEL`) as RegentConfig['log']['level'];
  }
  if (readEnv(`${PREFIX}LOG_FORMAT`)) {
    log.format = readEnv(`${PREFIX}LOG_FORMAT`) as RegentConfig['log']['format'];
  }

  const cache: { enabled?: boolean; maxBytes?: number } = {};
  if (readEnv(`${PREFIX}CACHE_ENABLED`)) {
    cache.enabled = parseBool(`${PREFIX}CACHE_ENABLED`, readEnv(`${PREFIX}CACHE_ENABLED`)!);
  }
  if (readEnv(`${PREFIX}CACHE_MAX_BYTES`)) {
    cache.maxBytes = parseInt10(`${PREFIX}CACHE_MAX_BYTES`, readEnv(`${PREFIX}CACHE_MAX_BYTES`)!);
  }

  const output: { color?: boolean; contextBuffer?: number } = {};
  if (readEnv(`${PREFIX}OUTPUT_COLOR`)) {
    output.color = parseBool(`${PREFIX}OUTPUT_COLOR`, readEnv(`${PREFIX}OUTPUT_COLOR`)!);
  }
  if (readEnv(`${PREFIX}OUTPUT_CONTEXT_BUFFER`)) {
    output.contextBuffer = parseInt10(
      `${PREFIX}OUTPUT_CONTEXT_BUFFER`,
      readEnv(`${PREFIX}OUTPUT_CONTEXT_BUFFER`)!,
    );
  }

  // Touch env to silence unused-var warning when none of the sub-keys
  // are present (we still want this branch to exist so future vars
  // are easy to add).
  void env;

  const candidate = {
    rules: { detect: [], fix: [] },
    excludePaths: [],
    excludeGroups: {},
    cache,
    log,
    output,
  };
  const hasAny =
    Object.keys(cache).length > 0 ||
    Object.keys(log).length > 0 ||
    Object.keys(output).length > 0;
  if (!hasAny) {
    return null;
  }
  const parsed = safeParseConfig(candidate);
  if (!parsed.ok) {
    throw new Error(`env config validation failed: ${parsed.error}`);
  }
  return parsed.value;
}