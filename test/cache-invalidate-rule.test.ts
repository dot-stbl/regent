/**
 * L0: cache invalidation by rule (#20).
 *
 * `DiskCache.invalidate({ ruleId })` was documented but only
 * `invalidate({ fileHash })` worked. The composite key is
 * `fileHash|ruleHash|ruleKind`, so dropping a single rule's findings
 * needs a reverse `ruleId → ruleHash` index. This file verifies:
 *
 *   1. set() with a key carrying `ruleId` populates the index.
 *   2. invalidate({ ruleId }) drops only matching entries.
 *   3. invalidate({ ruleId }) preserves other rules' entries.
 *   4. invalidate({ ruleId }) survives a load() — the index is
 *      rebuilt from the on-disk entries.
 *   5. invalidate({ ruleId }) is a no-op when no entries match.
 *   6. invalidate({}) with neither ruleId nor fileHash is a no-op.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DiskCache, cacheKeyFor, type CacheKey } from '../src/core/cache.js';

describe('DiskCache.invalidate by ruleId', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'regent-cache-rule-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('drops only entries for the given ruleId', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });

    // Two rules, two files each.
    const ruleA: CacheKey = { fileHash: 'f1', ruleHash: 'h-a', ruleKind: 'detect', ruleId: 'rule.a' };
    const ruleB: CacheKey = { fileHash: 'f1', ruleHash: 'h-b', ruleKind: 'detect', ruleId: 'rule.b' };
    const ruleA2: CacheKey = { fileHash: 'f2', ruleHash: 'h-a', ruleKind: 'detect', ruleId: 'rule.a' };
    const ruleB2: CacheKey = { fileHash: 'f2', ruleHash: 'h-b', ruleKind: 'detect', ruleId: 'rule.b' };

    cache.set(ruleA, { durationMs: 1, writtenAt: Date.now() });
    cache.set(ruleB, { durationMs: 2, writtenAt: Date.now() });
    cache.set(ruleA2, { durationMs: 3, writtenAt: Date.now() });
    cache.set(ruleB2, { durationMs: 4, writtenAt: Date.now() });

    cache.invalidate({ ruleId: 'rule.a' });

    expect(cache.get(ruleA)).toBeUndefined();
    expect(cache.get(ruleA2)).toBeUndefined();
    expect(cache.get(ruleB)).toBeDefined();
    expect(cache.get(ruleB)?.durationMs).toBe(2);
    expect(cache.get(ruleB2)).toBeDefined();
    expect(cache.get(ruleB2)?.durationMs).toBe(4);
  });

  it('drops both detect and fix entries for the rule', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });

    const detectKey: CacheKey = { fileHash: 'f1', ruleHash: 'h-x', ruleKind: 'detect', ruleId: 'rule.x' };
    const fixKey: CacheKey = { fileHash: 'f1', ruleHash: 'h-x', ruleKind: 'fix', ruleId: 'rule.x' };

    cache.set(detectKey, { durationMs: 1, writtenAt: Date.now() });
    cache.set(fixKey, { fixedContent: 'patched', durationMs: 2, writtenAt: Date.now() });

    cache.invalidate({ ruleId: 'rule.x' });

    expect(cache.get(detectKey)).toBeUndefined();
    expect(cache.get(fixKey)).toBeUndefined();
  });

  it('preserves the rule when invalidated under a different id', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });

    const key: CacheKey = { fileHash: 'f1', ruleHash: 'h-y', ruleKind: 'detect', ruleId: 'rule.y' };
    cache.set(key, { durationMs: 1, writtenAt: Date.now() });

    cache.invalidate({ ruleId: 'rule.NOPE' });

    expect(cache.get(key)).toBeDefined();
  });

  it('is a no-op when no entries match', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });
    const key: CacheKey = { fileHash: 'f1', ruleHash: 'h-z', ruleKind: 'detect', ruleId: 'rule.z' };
    cache.set(key, { durationMs: 1, writtenAt: Date.now() });

    expect(() => cache.invalidate({ ruleId: 'rule.NOPE' })).not.toThrow();
    expect(cache.get(key)).toBeDefined();
  });

  it('handles a key without a ruleId gracefully (still indexable later)', () => {
    // Defensive: an entry written via cacheKeyFor without a ruleId
    // is invisible to invalidate({ ruleId }) but doesn't break it.
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });

    const kNoRule: CacheKey = cacheKeyFor('content', { id: 'r' }, 'detect');
    const kWithRule: CacheKey = cacheKeyFor('content', { id: 'r' }, 'detect', 'r.id');

    cache.set(kNoRule, { durationMs: 1, writtenAt: Date.now() });
    cache.set(kWithRule, { durationMs: 2, writtenAt: Date.now() });

    // Sanity: they have the same composite key (ruleHash + ruleKind +
    // fileHash), so the second set() overwrites the first.
    cache.invalidate({ ruleId: 'r.id' });
    expect(cache.get(kWithRule)).toBeUndefined();
  });

  it('survives a load() — the index is rebuilt from on-disk entries', () => {
    const path = join(tmp, 'cache.json');
    const cache1 = new DiskCache({ path, maxBytes: 1024 * 1024 });

    const kA: CacheKey = { fileHash: 'f1', ruleHash: 'h-a', ruleKind: 'detect', ruleId: 'rule.a' };
    const kB: CacheKey = { fileHash: 'f1', ruleHash: 'h-b', ruleKind: 'detect', ruleId: 'rule.b' };
    cache1.set(kA, { durationMs: 1, writtenAt: Date.now() });
    cache1.set(kB, { durationMs: 2, writtenAt: Date.now() });

    // Fresh cache — simulates a process restart. The reverse index
    // must be rebuilt from the on-disk entries.
    const cache2 = new DiskCache({ path, maxBytes: 1024 * 1024 });

    cache2.invalidate({ ruleId: 'rule.a' });

    expect(cache2.get(kA)).toBeUndefined();
    expect(cache2.get(kB)).toBeDefined();
  });

  it('invalidate({}) with neither scope is a no-op', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });
    const kA: CacheKey = { fileHash: 'f1', ruleHash: 'h-a', ruleKind: 'detect', ruleId: 'rule.a' };
    cache.set(kA, { durationMs: 1, writtenAt: Date.now() });

    expect(() => cache.invalidate({})).not.toThrow();
    expect(cache.get(kA)).toBeDefined();
  });

  it('ruleId and fileHash can be combined in one call', () => {
    const cache = new DiskCache({
      path: join(tmp, 'cache.json'),
      maxBytes: 1024 * 1024,
    });

    // rule.a on file f1 — should be dropped by ruleId.
    const a1: CacheKey = { fileHash: 'f1', ruleHash: 'h-a', ruleKind: 'detect', ruleId: 'rule.a' };
    // rule.a on file f2 — should be dropped by ruleId.
    const a2: CacheKey = { fileHash: 'f2', ruleHash: 'h-a', ruleKind: 'detect', ruleId: 'rule.a' };
    // rule.b on file f1 — should be dropped by fileHash.
    const b1: CacheKey = { fileHash: 'f1', ruleHash: 'h-b', ruleKind: 'detect', ruleId: 'rule.b' };
    // rule.b on file f2 — should be preserved.
    const b2: CacheKey = { fileHash: 'f2', ruleHash: 'h-b', ruleKind: 'detect', ruleId: 'rule.b' };

    cache.set(a1, { durationMs: 1, writtenAt: Date.now() });
    cache.set(a2, { durationMs: 2, writtenAt: Date.now() });
    cache.set(b1, { durationMs: 3, writtenAt: Date.now() });
    cache.set(b2, { durationMs: 4, writtenAt: Date.now() });

    cache.invalidate({ ruleId: 'rule.a', fileHash: 'f1' });

    expect(cache.get(a1)).toBeUndefined();
    expect(cache.get(a2)).toBeUndefined();
    expect(cache.get(b1)).toBeUndefined();
    expect(cache.get(b2)).toBeDefined();
  });

  it('persists the ruleId through the entry (round-trip via disk)', () => {
    // The whole point of putting ruleId in the entry (not just the
    // key) is that load() can rebuild the index from the on-disk
    // entry. Verify the entry actually carries the ruleId after a
    // round-trip through write + read.
    const path = join(tmp, 'cache.json');
    const cache1 = new DiskCache({ path, maxBytes: 1024 * 1024 });
    const k: CacheKey = {
      fileHash: 'f1',
      ruleHash: 'h-rt',
      ruleKind: 'detect',
      ruleId: 'rule.rt',
    };
    cache1.set(k, { durationMs: 7, writtenAt: Date.now() });

    // The DiskCache in this test doesn't expose raw entries, but
    // the load()'s rebuild path is exercised by the surviving-load
    // test above. Here we just confirm the entry round-trips with
    // the expected duration, and that invalidate() finds it.
    const cache2 = new DiskCache({ path, maxBytes: 1024 * 1024 });
    expect(cache2.get(k)?.durationMs).toBe(7);
    cache2.invalidate({ ruleId: 'rule.rt' });
    expect(cache2.get(k)).toBeUndefined();
  });
});
