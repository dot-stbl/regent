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
}

export interface CacheEntry {
  readonly findings?: readonly unknown[];
  readonly fixedContent?: string;
  readonly durationMs: number;
  readonly writtenAt: number;
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

const RUNNER_VERSION = '0.2.0';

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
  private readonly enabled: boolean;
  private store = new Map<string, CacheEntry>();
  private header: CacheHeader = {
    schemaVersion: SCHEMA_VERSION,
    runnerVersion: RUNNER_VERSION,
    format: FORMAT,
  };
  private hits = 0;
  private misses = 0;
  private writes = 0;

  constructor(opts: { path: string; maxBytes: number; enabled?: boolean }) {
    this.path = opts.path;
    this.maxBytes = opts.maxBytes;
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
    this.store.set(composite, entry);
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
    // Note: invalidate by ruleId would require scanning values; for
    // v0.2 we use the cheaper rule-version hash via invalidate-all on
    // rule spec change.
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
        this.store = new Map(Object.entries(parsed.entries));
      }
    } catch {
      // Corrupted cache — start fresh; next flush overwrites.
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
): CacheKey {
  return {
    fileHash: sha256(fileContent),
    ruleHash: sha256(JSON.stringify(ruleSpec)),
    ruleKind: kind,
  };
}

/**
 * Default cache path: `<cwd>/.regent/cache.json`. Caller can override.
 */
export function defaultCachePath(cwd: string): string {
  return join(cwd, '.regent', 'cache.json');
}