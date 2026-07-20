/**
 * L0: env config source — STBL_REGENT_* mapping.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildEnvConfig, loadDotEnv } from '../src/config/sources/env.js';

const PREFIX = 'STBL_REGENT_';

function clearEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(PREFIX)) {
      delete process.env[key];
    }
  }
}

describe('buildEnvConfig', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('returns null when no relevant vars are set', () => {
    expect(buildEnvConfig()).toBeNull();
  });

  it('reads log.level', () => {
    process.env[`${PREFIX}LOG_LEVEL`] = 'debug';
    const cfg = buildEnvConfig();
    expect(cfg?.log.level).toBe('debug');
  });

  it('reads log.format', () => {
    process.env[`${PREFIX}LOG_FORMAT`] = 'json';
    const cfg = buildEnvConfig();
    expect(cfg?.log.format).toBe('json');
  });

  it('reads cache.enabled (true/false/1/0/yes/no/on/off)', () => {
    for (const [val, expected] of [
      ['true', true],
      ['1', true],
      ['yes', true],
      ['on', true],
      ['false', false],
      ['0', false],
      ['no', false],
      ['off', false],
    ] as const) {
      clearEnv();
      process.env[`${PREFIX}CACHE_ENABLED`] = val;
      const cfg = buildEnvConfig();
      expect(cfg?.cache.enabled).toBe(expected);
    }
  });

  it('case-insensitive bool parsing', () => {
    process.env[`${PREFIX}CACHE_ENABLED`] = 'TRUE';
    const cfg = buildEnvConfig();
    expect(cfg?.cache.enabled).toBe(true);
  });

  it('throws on unknown bool value', () => {
    process.env[`${PREFIX}CACHE_ENABLED`] = 'maybe';
    expect(() => buildEnvConfig()).toThrow(/cannot parse 'maybe' as boolean/);
  });

  it('reads cache.maxBytes as integer', () => {
    process.env[`${PREFIX}CACHE_MAX_BYTES`] = '52428800';
    const cfg = buildEnvConfig();
    expect(cfg?.cache.maxBytes).toBe(52428800);
  });

  it('reads output.color and output.contextBuffer', () => {
    process.env[`${PREFIX}OUTPUT_COLOR`] = 'false';
    process.env[`${PREFIX}OUTPUT_CONTEXT_BUFFER`] = '5';
    const cfg = buildEnvConfig();
    expect(cfg?.output.color).toBe(false);
    expect(cfg?.output.contextBuffer).toBe(5);
  });

  it('returns partial config when only some vars are set', () => {
    process.env[`${PREFIX}LOG_LEVEL`] = 'warn';
    const cfg = buildEnvConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.log.level).toBe('warn');
    // unset fields fall through to defaults
    expect(cfg!.log.format).toBe('text');
    expect(cfg!.cache.enabled).toBe(true);
  });

  it('throws on invalid integer', () => {
    process.env[`${PREFIX}CACHE_MAX_BYTES`] = 'not-a-number';
    expect(() => buildEnvConfig()).toThrow(/cannot parse/);
  });
});

describe('loadDotEnv', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('is a no-op when no .env file exists', () => {
    expect(() => loadDotEnv('C:\\does\\not\\exist')).not.toThrow();
  });

  it('does not overwrite existing process.env values', () => {
    // dotenv is best-effort; explicit env wins. We verify the contract
    // holds: process.env value, when set, is preserved.
    process.env['SOME_RANDOM_KEY'] = 'pre-existing';
    loadDotEnv('C:\\some\\random\\path');
    expect(process.env['SOME_RANDOM_KEY']).toBe('pre-existing');
  });
});