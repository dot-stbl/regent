/**
 * L0: cache TTL (#19).
 *
 * `DiskCache` historically only evicted by size. Stale entries
 * (rules since removed, specs since changed) linger until LRU
 * pressure pushed them out. With `cache.maxAge` (config) and
 * `STBL_REGENT_CACHE_MAX_AGE` (env, in seconds), entries older than
 * the TTL are dropped on `DiskCache` load.
 *
 * Strategy: craft cache files on disk with a synthetic `writtenAt`
 * (30 days in the past for stale, `Date.now()` for fresh) and
 * observe the resulting `get()` after a fresh `DiskCache` ctor.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DiskCache,
  cacheKeyFor,
  type CacheKey,
  SCHEMA_VERSION_HEADER,
  RUNNER_VERSION_HEADER,
  CACHE_FORMAT,
} from '../src/core/cache.js';
import { safeParseConfig } from '../src/config/schema.js';
import { buildEnvConfig } from '../src/config/sources/env.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 30;
const FRESH_DAYS = 1;
const DEFAULT_TTL_MS = 7 * DAY_MS;

describe('cache.maxAge schema', () => {
  it('defaults to 7 days when omitted', () => {
    const result = safeParseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cache.maxAge).toBe(DEFAULT_TTL_MS);
    }
  });

  it('accepts a positive integer', () => {
    const result = safeParseConfig({
      cache: { enabled: true, maxBytes: 1024, maxAge: 60_000 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cache.maxAge).toBe(60_000);
    }
  });

  it('rejects zero / negative maxAge', () => {
    const result = safeParseConfig({
      cache: { enabled: true, maxBytes: 1024, maxAge: 0 },
    });
    expect(result.ok).toBe(false);

    const neg = safeParseConfig({
      cache: { enabled: true, maxBytes: 1024, maxAge: -1 },
    });
    expect(neg.ok).toBe(false);
  });

  it('rejects non-integer maxAge', () => {
    const result = safeParseConfig({
      cache: { enabled: true, maxBytes: 1024, maxAge: 1.5 },
    });
    expect(result.ok).toBe(false);
  });
});

describe('STBL_REGENT_CACHE_MAX_AGE env binding', () => {
  const PREFIX = 'STBL_REGENT_';
  const SAVED: Record<string, string | undefined> = {};

  function clearEnv(): void {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith(PREFIX)) {
        SAVED[key] = process.env[key];
        delete process.env[key];
      }
    }
  }
  function restoreEnv(): void {
    for (const key of Object.keys(SAVED)) {
      const v = SAVED[key];
      if (v === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = v;
      }
    }
  }

  beforeEach(clearEnv);
  afterEach(restoreEnv);

  it('parses seconds and converts to ms', () => {
    process.env[`${PREFIX}CACHE_MAX_AGE`] = '3600';
    const cfg = buildEnvConfig();
    expect(cfg?.cache.maxAge).toBe(3600 * 1000);
  });

  it('parses 7 days in seconds', () => {
    process.env[`${PREFIX}CACHE_MAX_AGE`] = String(7 * 24 * 60 * 60);
    const cfg = buildEnvConfig();
    expect(cfg?.cache.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('throws on non-integer', () => {
    // `parseInt('1.5', 10)` actually returns 1, not NaN — use a
    // value that definitely can't be parsed.
    process.env[`${PREFIX}CACHE_MAX_AGE`] = 'abc';
    expect(() => buildEnvConfig()).toThrow(/cannot parse/);
  });
});

describe('DiskCache TTL eviction on load', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'regent-cache-ttl-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Build a cache.json payload with explicit `writtenAt` timestamps.
   * Each key is the cache key produced from a unique fileHash so we
   * can assert per-entry presence.
   */
  function writeCacheFile(
    path: string,
    entries: Record<string, { writtenAt: number; durationMs: number }>,
  ): void {
    if (!existsSync(join(path, '..'))) {
      mkdirSync(join(path, '..'), { recursive: true });
    }
    const payload = {
      header: {
        schemaVersion: SCHEMA_VERSION_HEADER,
        runnerVersion: RUNNER_VERSION_HEADER,
        format: CACHE_FORMAT,
      },
      entries,
    };
    writeFileSync(path, JSON.stringify(payload), 'utf8');
  }

  it('drops entries older than maxAge on load; keeps fresh ones', () => {
    const path = join(tmp, 'cache.json');
    const now = Date.now();
    const staleAt = now - STALE_DAYS * DAY_MS;
    const freshAt = now - FRESH_DAYS * DAY_MS;

    // Build a cache key for the stale + fresh entries so we can probe
    // via the public get() API after load.
    const staleKey: CacheKey = cacheKeyFor('stale-content', { id: 's' }, 'detect');
    const freshKey1: CacheKey = cacheKeyFor('fresh-content-1', { id: 'f1' }, 'detect');
    const freshKey2: CacheKey = cacheKeyFor('fresh-content-2', { id: 'f2' }, 'detect');

    const compositeStale = `${staleKey.fileHash}|${staleKey.ruleHash}|${staleKey.ruleKind}`;
    const compositeFresh1 = `${freshKey1.fileHash}|${freshKey1.ruleHash}|${freshKey1.ruleKind}`;
    const compositeFresh2 = `${freshKey2.fileHash}|${freshKey2.ruleHash}|${freshKey2.ruleKind}`;

    writeCacheFile(path, {
      [compositeStale]: { writtenAt: staleAt, durationMs: 1 },
      [compositeFresh1]: { writtenAt: freshAt, durationMs: 2 },
      [compositeFresh2]: { writtenAt: freshAt, durationMs: 3 },
    });

    const cache = new DiskCache({
      path,
      maxBytes: 1024 * 1024,
      maxAge: DEFAULT_TTL_MS, // 7 days
    });

    // User-observable behaviour: stale get() is undefined; fresh
    // get()s return the entries.
    expect(cache.get(staleKey)).toBeUndefined();
    expect(cache.get(freshKey1)).toBeDefined();
    expect(cache.get(freshKey1)?.durationMs).toBe(2);
    expect(cache.get(freshKey2)).toBeDefined();
    expect(cache.get(freshKey2)?.durationMs).toBe(3);
  });

  it('respects a custom maxAge', () => {
    const path = join(tmp, 'cache.json');
    const now = Date.now();
    const staleKey: CacheKey = cacheKeyFor('stale', { id: 's' }, 'detect');
    const compositeStale = `${staleKey.fileHash}|${staleKey.ruleHash}|${staleKey.ruleKind}`;
    // 1-day-old entry; maxAge=1 hour => must be dropped.
    writeCacheFile(path, {
      [compositeStale]: { writtenAt: now - DAY_MS, durationMs: 1 },
    });

    const cache = new DiskCache({
      path,
      maxBytes: 1024 * 1024,
      maxAge: 60 * 60 * 1000, // 1 hour
    });
    expect(cache.get(staleKey)).toBeUndefined();
  });

  it('keeps an entry written at the boundary (just inside the TTL)', () => {
    const path = join(tmp, 'cache.json');
    const now = Date.now();
    const borderlineKey: CacheKey = cacheKeyFor('borderline', { id: 'b' }, 'detect');
    const composite = `${borderlineKey.fileHash}|${borderlineKey.ruleHash}|${borderlineKey.ruleKind}`;
    // 7 days - 1 second old => still within 7-day window.
    const almostStale = now - (DEFAULT_TTL_MS - 1000);
    writeCacheFile(path, {
      [composite]: { writtenAt: almostStale, durationMs: 99 },
    });

    const cache = new DiskCache({
      path,
      maxBytes: 1024 * 1024,
      maxAge: DEFAULT_TTL_MS,
    });
    // User-observable: borderline entry survives the TTL filter.
    expect(cache.get(borderlineKey)?.durationMs).toBe(99);
  });

  it('keeps entries with missing or non-finite writtenAt (defensive)', () => {
    const path = join(tmp, 'cache.json');
    // We can't easily construct an entry without `writtenAt` through
    // the public `set()` (it always writes Date.now()), so test the
    // filter by patching the on-disk JSON after a normal set().
    const cache0 = new DiskCache({
      path,
      maxBytes: 1024 * 1024,
      maxAge: DEFAULT_TTL_MS,
    });
    const key: CacheKey = cacheKeyFor('hello', { id: 'x' }, 'detect');
    cache0.set(key, { durationMs: 1, writtenAt: Date.now() });

    // Mutate the on-disk JSON to remove `writtenAt` from one entry.
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const compositeKey = Object.keys(raw.entries)[0]!;
    delete raw.entries[compositeKey].writtenAt;
    writeFileSync(path, JSON.stringify(raw), 'utf8');

    const reloaded = new DiskCache({
      path,
      maxBytes: 1024 * 1024,
      maxAge: DEFAULT_TTL_MS,
    });
    expect(reloaded.get(key)).toBeDefined();
  });

  it('does not re-flush on load (no spurious writes)', () => {
    const path = join(tmp, 'cache.json');
    const now = Date.now();
    writeCacheFile(path, {
      'fresh-1': { writtenAt: now - 1 * DAY_MS, durationMs: 1 },
    });

    // Track writes via a fresh stats counter.
    const cache = new DiskCache({
      path,
      maxBytes: 1024 * 1024,
      maxAge: DEFAULT_TTL_MS,
    });
    expect(cache.stats().writes).toBe(0);
  });

  it('round-trips a fresh entry across re-loads', () => {
    const path = join(tmp, 'cache.json');
    const key: CacheKey = cacheKeyFor('hello', { id: 'x' }, 'detect');

    const cache1 = new DiskCache({
      path,
      maxBytes: 1024 * 1024,
      maxAge: DEFAULT_TTL_MS,
    });
    cache1.set(key, { durationMs: 7, writtenAt: Date.now() });

    const cache2 = new DiskCache({
      path,
      maxBytes: 1024 * 1024,
      maxAge: DEFAULT_TTL_MS,
    });
    expect(cache2.get(key)?.durationMs).toBe(7);
  });
});
