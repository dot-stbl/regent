/**
 * L0: cache layer — sha256 keys, version header, atomic write, LRU cap.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DiskCache,
  cacheKeyFor,
  defaultCachePath,
  type CacheKey,
} from '../src/core/cache.js';

describe('cacheKeyFor', () => {
  it('produces deterministic hashes', () => {
    const a = cacheKeyFor('hello', { id: 'x' }, 'detect');
    const b = cacheKeyFor('hello', { id: 'x' }, 'detect');
    expect(a.fileHash).toBe(b.fileHash);
    expect(a.ruleHash).toBe(b.ruleHash);
  });

  it('produces different hashes for different inputs', () => {
    const a = cacheKeyFor('hello', { id: 'x' }, 'detect');
    const b = cacheKeyFor('world', { id: 'x' }, 'detect');
    expect(a.fileHash).not.toBe(b.fileHash);
  });

  it('different kinds produce different keys', () => {
    const a = cacheKeyFor('hello', { id: 'x' }, 'detect');
    const b = cacheKeyFor('hello', { id: 'x' }, 'fix');
    expect(a.ruleKind).toBe('detect');
    expect(b.ruleKind).toBe('fix');
  });
});

describe('DiskCache', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'regent-cache-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns undefined for an empty cache', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });
    const key = cacheKeyFor('hello', { id: 'x' }, 'detect');
    expect(cache.get(key)).toBeUndefined();
  });

  it('round-trips a value', () => {
    const path = join(tmp, 'cache.json');
    const cache = new DiskCache({ path, maxBytes: 1024 * 1024 });
    const key = cacheKeyFor('hello', { id: 'x' }, 'detect');
    const entry = {
      findings: [{ id: 'x', line: 1 }],
      durationMs: 12,
      writtenAt: Date.now(),
    };
    cache.set(key, entry);
    expect(cache.get(key)).toBeDefined();
    expect(cache.get(key)!.durationMs).toBe(12);

    // Reload from disk — verify persistence.
    const reloaded = new DiskCache({ path, maxBytes: 1024 * 1024 });
    expect(reloaded.get(key)?.durationMs).toBe(12);
  });

  it('counts hits and misses', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });
    const key = cacheKeyFor('hello', { id: 'x' }, 'detect');
    cache.get(key); // miss
    cache.set(key, { durationMs: 1, writtenAt: Date.now() });
    cache.get(key); // hit
    cache.get(key); // hit
    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });

  it('does not write when disabled', () => {
    const path = join(tmp, 'cache.json');
    const cache = new DiskCache({
      path,
      maxBytes: 1024 * 1024,
      enabled: false,
    });
    cache.set(cacheKeyFor('hello', {}, 'detect'), {
      durationMs: 1,
      writtenAt: Date.now(),
    });
    expect(cache.stats().writes).toBe(0);
    // Disk file should not exist (never written).
    expect(existsSync(path)).toBe(false);
  });

  it('invalidate by fileHash removes all entries for that file', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });
    const fileHash = 'hash-of-foo';
    const k1: CacheKey = { fileHash, ruleHash: 'r1', ruleKind: 'detect' };
    const k2: CacheKey = { fileHash, ruleHash: 'r2', ruleKind: 'detect' };
    const k3: CacheKey = { fileHash: 'hash-of-bar', ruleHash: 'r1', ruleKind: 'detect' };
    cache.set(k1, { durationMs: 1, writtenAt: Date.now() });
    cache.set(k2, { durationMs: 1, writtenAt: Date.now() });
    cache.set(k3, { durationMs: 1, writtenAt: Date.now() });

    cache.invalidate({ fileHash });
    expect(cache.get(k1)).toBeUndefined();
    expect(cache.get(k2)).toBeUndefined();
    expect(cache.get(k3)).toBeDefined();
  });

  it('enforces maxBytes by LRU eviction', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 200,
    });
    for (let i = 0; i < 20; i++) {
      cache.set(
        cacheKeyFor(`file-${i}`, { ruleId: 'x' }, 'detect'),
        { durationMs: i, writtenAt: Date.now() + i },
      );
    }
    // Cache should be much smaller than 20 entries.
    expect(cache.stats().sizeBytes).toBeLessThan(500);
  });

  it('defaultCachePath returns <cwd>/.regent/cache.json', () => {
    const p = defaultCachePath('/tmp/repo');
    expect(p).toMatch(/\.regent[\\/]cache\.json$/);
  });

  it('flush writes the cache to disk', () => {
    const path = join(tmp, 'cache.json');
    const cache = new DiskCache({ path, maxBytes: 1024 * 1024 });
    cache.set(cacheKeyFor('hello', { id: 'x' }, 'detect'), {
      durationMs: 5,
      writtenAt: 12345,
    });
    cache.flush();
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('"durationMs":5');
    expect(text).toContain('"schemaVersion":1');
  });
});