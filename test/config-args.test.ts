/**
 * L0: args config source — CLI flag → config mapping.
 */

import { describe, expect, it } from 'vitest';

import { buildArgsConfig } from '../src/config/sources/args.js';

describe('buildArgsConfig', () => {
  it('returns null when no recognised args are set', () => {
    expect(buildArgsConfig({})).toBeNull();
  });

  it('reads logLevel', () => {
    const cfg = buildArgsConfig({ logLevel: 'debug' });
    expect(cfg?.log.level).toBe('debug');
  });

  it('reads logFormat', () => {
    const cfg = buildArgsConfig({ logFormat: 'json' });
    expect(cfg?.log.format).toBe('json');
  });

  it('reads cache (no-color style)', () => {
    expect(buildArgsConfig({ cache: false })?.cache.enabled).toBe(false);
    expect(buildArgsConfig({ cache: true })?.cache.enabled).toBe(true);
  });

  it('reads color', () => {
    expect(buildArgsConfig({ color: false })?.output.color).toBe(false);
  });

  it('reads contextBuffer', () => {
    expect(buildArgsConfig({ contextBuffer: 7 })?.output.contextBuffer).toBe(7);
  });

  it('returns partial config when only some args are set', () => {
    const cfg = buildArgsConfig({ logLevel: 'warn' });
    expect(cfg).not.toBeNull();
    expect(cfg!.log.level).toBe('warn');
    expect(cfg!.log.format).toBe('text'); // default
  });
});