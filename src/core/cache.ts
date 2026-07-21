// Cache layer for v0.2.
//
// Key: sha256(fileContent) + sha256(ruleSpecJson) + kind.
// Value: { findings, fixedContent?, durationMs, writtenAt }.
//
// Header on disk (`.regent/cache.json`):
//   { schemaVersion, runnerVersion, format } — any change invalidates
//   the entire cache (cheap and safe).
//
// LRU eviction when total bytes > maxBytes (config.cache.maxBytes).
// TTL eviction on load: entries with `writtenAt` older than
// `cache.maxAge` (default 7 days) are dropped silently — keeps stale
// findings from a since-changed rule from haunting later runs.
// Atomic write via tmp + rename (no torn files on crash).
//
// `--no-cache` bypass: read returns null, write returns silently.
//
// File-level lock for `regent fix --write` (Phase 5+; for detect-only
// runs the lock is unnecessary because the cache itself gates reads).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCHEMA_VERSION = 1;
const FORMAT = 'json' as const;

export interface CacheHeader {
  readonly schemaVersion: number;
  readonly runnerVersion: string;
  readonly format: typeof FORMAT;
}

export interface CacheKey {
  readonly fileHash: string;
  readonly ruleHash: string;
  readonly ruleKind: 'detect' | 'fix';
  /**
   * Optional `ruleId` (e.g. `csharp.no-region`) — used by
   * `DiskCache` to build a reverse index so `invalidate({ ruleId })`
   * can drop all cached findings for that rule without scanning
   * every entry. Not part of the on-disk composite key (which
   * uses `fileHash|ruleHash|ruleKind`); safe to omit when callers
   * only need the lookup half of the cache.
   */
  readonly ruleId?: string;
}

export interface CacheEntry {
  readonly findings?: readonly unknown[];
  readonly fixedContent?: string;
  readonly durationMs: number;
  readonly writtenAt: number;
  /**
   * Optional `ruleId` (e.g. `csharp.no-region`) — used by
   * `DiskCache.invalidate({ ruleId })` to drop every cached finding
   * for a rule without scanning every entry's stored value. Persisted
   * with the entry so the reverse index is rebuilt on `load()`.
   */
  readonly ruleId?: string;
}

export interface CacheStore {
  get(key: CacheKey): CacheEntry | undefined;
  set(key: CacheKey, entry: CacheEntry): void;
  invalidate(scope: { ruleId?: string; fileHash?: string }): void;
  stats(): CacheStats;
  flush(): void;
}

export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly writes: number;
  readonly sizeBytes: number;
}

const RUNNER_VERSION = '0.3.0';

// Re-export the header values so tests can construct a valid
// on-disk cache file (see `test/cache-ttl.test.ts`).
export const SCHEMA_VERSION_HEADER = SCHEMA_VERSION;
export const RUNNER_VERSION_HEADER = RUNNER_VERSION;
export const CACHE_FORMAT = FORMAT;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Disk-backed JSON cache. The whole cache is read once at construction
 * and written back on every `set` (cheap for sub-MB caches; for larger
 * ones, swap in mmap + append-only later).
 */
export class DiskCache implements CacheStore {
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly maxAge: number;
  private readonly enabled: boolean;
  private store = new Map<string, CacheEntry>();
  /**
   * Reverse index from `ruleId` to the set of `ruleHash` values we've
   * written for that rule. Populated on every `set()` (and during
   * `load()` for existing entries) so `invalidate({ ruleId })` can
   * drop everything we've ever cached for that id without scanning
   * every entry's stored value.
   */
  private ruleHashesByRuleId = new Map<string, Set<string>>();
  private header: CacheHeader = {
    schemaVersion: SCHEMA_VERSION,
    runnerVersion: RUNNER_VERSION,
    format: FORMAT,
  };
  private hits = 0;
  private misses = 0;
  private writes = 0;

  constructor(
    opts: { path: string; maxBytes: number; maxAge?: number; enabled?: boolean },
  ) {
    this.path = opts.path;
    this.maxBytes = opts.maxBytes;
    this.maxAge = opts.maxAge ?? 7 * 24 * 60 * 60 * 1000;
    this.enabled = opts.enabled ?? true;
    if (this.enabled) {
      this.load();
    }
  }

  get(key: CacheKey): CacheEntry | undefined {
    if (!this.enabled) {
      this.misses++;
      return undefined;
    }
    const composite = `${key.fileHash}|${key.ruleHash}|${key.ruleKind}`;
    const entry = this.store.get(composite);
    if (entry) {
      this.hits++;
      return entry;
    }
    this.misses++;
    return undefined;
  }

  set(key: CacheKey, entry: CacheEntry): void {
    if (!this.enabled) {
      return;
    }
    const composite = `${key.fileHash}|${key.ruleHash}|${key.ruleKind}`;
    // If the caller supplies a `ruleId` on the key but not on the
    // entry, copy it through so the on-disk format carries it
    // (needed for invalidate-by-ruleId across restarts). When the
    // entry already has a `ruleId`, that one wins — the key's value
    // is treated as a hint, not an override.
    const entryWithRuleId: CacheEntry = entry.ruleId === undefined && key.ruleId !== undefined
      ? { ...entry, ruleId: key.ruleId }
      : entry;
    this.store.set(composite, entryWithRuleId);
    this.indexRule(key);
    this.writes++;
    this.enforceCap();
    this.flush();
  }

  invalidate(scope: { ruleId?: string; fileHash?: string }): void {
    if (scope.fileHash !== undefined) {
      const prefix = `${scope.fileHash}|`;
      for (const key of this.store.keys()) {
        if (key.startsWith(prefix)) {
          this.store.delete(key);
        }
      }
    }
    if (scope.ruleId !== undefined) {
      const hashes = this.ruleHashesByRuleId.get(scope.ruleId);
      if (hashes && hashes.size > 0) {
        for (const ruleHash of hashes) {
          // Match the middle segment of the composite key. There are
          // only two `ruleKind` values (`detect` / `fix`); iterate
          // them rather than parsing the key, so the composite
          // format stays free to evolve.
          for (const ruleKind of ['detect', 'fix'] as const) {
            const composite = `|${ruleHash}|${ruleKind}`;
            for (const key of this.store.keys()) {
              if (key.endsWith(composite)) {
                this.store.delete(key);
              }
            }
          }
        }
        // Drop the reverse-index entry once we've cleared all
        // hashes — the rule is no longer represented in the store.
        this.ruleHashesByRuleId.delete(scope.ruleId);
      }
    }
    this.flush();
  }

  stats(): CacheStats {
    let sizeBytes = 0;
    try {
      sizeBytes = existsSync(this.path) ? statSync(this.path).size : 0;
    } catch {
      // ignore
    }
    return { hits: this.hits, misses: this.misses, writes: this.writes, sizeBytes };
  }

  flush(): void {
    if (!this.enabled) {
      return;
    }
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const payload = {
      header: this.header,
      entries: Object.fromEntries(this.store),
    };
    const text = JSON.stringify(payload);
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, this.path);
  }

  private load(): void {
    if (!existsSync(this.path)) {
      return;
    }
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as {
        header?: CacheHeader;
        entries?: Record<string, CacheEntry>;
      };
      if (parsed.header?.schemaVersion !== SCHEMA_VERSION) {
        return; // schema bump — invalidate
      }
      if (parsed.header.runnerVersion !== RUNNER_VERSION) {
        return; // runner bump — invalidate
      }
      if (parsed.entries) {
        const cutoff = Date.now() - this.maxAge;
        const next = new Map<string, CacheEntry>();
        for (const [key, entry] of Object.entries(parsed.entries)) {
          // Drop entries older than the TTL. Missing or future
          // `writtenAt` are kept as-is (defensive — shouldn't happen
          // in a cache we wrote, but be lenient on third-party data).
          if (
            typeof entry?.writtenAt === 'number'
            && entry.writtenAt < cutoff
          ) {
            continue;
          }
          next.set(key, entry);
        }
        this.store = next;
        // Rebuild the reverse ruleId → ruleHash index from loaded
        // entries so invalidate({ ruleId }) works across restarts.
        this.rebuildIndexFromStore();
      }
    } catch {
      // Corrupted cache — start fresh; next flush overwrites.
    }
  }

  /**
   * Add a `ruleId → ruleHash` mapping for a freshly-written entry.
   * No-op when the key has no `ruleId` (the reverse index is then
   * blind to the entry; invalidate({ ruleId }) won't see it).
   */
  private indexRule(key: CacheKey): void {
    if (key.ruleId === undefined) {
      return;
    }
    let set = this.ruleHashesByRuleId.get(key.ruleId);
    if (!set) {
      set = new Set();
      this.ruleHashesByRuleId.set(key.ruleId, set);
    }
    set.add(key.ruleHash);
  }

  /**
   * Rebuild the reverse index from the current `store` contents.
   * Called after a `load()` so the in-memory index survives process
   * restarts (as long as entries have a `ruleId`).
   */
  private rebuildIndexFromStore(): void {
    this.ruleHashesByRuleId.clear();
    for (const [composite, entry] of this.store) {
      const ruleId = entry.ruleId;
      if (typeof ruleId !== 'string' || ruleId.length === 0) {
        continue;
      }
      // Parse the ruleHash out of the composite key
      // (`fileHash|ruleHash|ruleKind`). Three segments, so the
      // middle one is unambiguous.
      const parts = composite.split('|');
      if (parts.length !== 3) {
        continue;
      }
      const ruleHash = parts[1]!;
      let set = this.ruleHashesByRuleId.get(ruleId);
      if (!set) {
        set = new Set();
        this.ruleHashesByRuleId.set(ruleId, set);
      }
      set.add(ruleHash);
    }
  }

  private enforceCap(): void {
    let sizeBytes = this.estimateBytes();
    while (sizeBytes > this.maxBytes && this.store.size > 0) {
      // Drop the oldest entry by writtenAt (LRU-ish).
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.store) {
        if (entry.writtenAt < oldestAt) {
          oldestAt = entry.writtenAt;
          oldestKey = key;
        }
      }
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
      sizeBytes = this.estimateBytes();
    }
  }

  private estimateBytes(): number {
    return JSON.stringify(Object.fromEntries(this.store)).length;
  }
}

export function cacheKeyFor(
  fileContent: string,
  ruleSpec: unknown,
  kind: 'detect' | 'fix',
  ruleId?: string,
): CacheKey {
  return {
    fileHash: sha256(fileContent),
    ruleHash: sha256(JSON.stringify(ruleSpec)),
    ruleKind: kind,
    ...(ruleId !== undefined ? { ruleId } : {}),
  };
}

/**
 * Default cache path: `<cwd>/.regent/cache.json`. Caller can override.
 */
export function defaultCachePath(cwd: string): string {
  return join(cwd, '.regent', 'cache.json');
}