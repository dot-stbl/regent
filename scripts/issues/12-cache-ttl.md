## Context

`DiskCache` evicts by size only. Stale entries (a rule no longer
loaded, a rule whose spec was tightened) linger until LRU
pressure. Add TTL (default 7 days, configurable) — entries older
than TTL are dropped on load.

## Current behaviour

Entries live forever (until LRU). A rule removed from config
might still have cached findings.

## Expected behaviour

- `cache.maxAge` (config field, default 7 days)
- on load: drop entries whose `writtenAt` is older than `maxAge`
- env: `STBL_REGENT_CACHE_MAX_AGE=<seconds>`
- Tests confirm: write entry with `writtenAt = now-30d`, reload,
  entry absent

## Acceptance criteria

- [ ] `cache.maxAge` schema field (default 7 * 24 * 60 * 60 * 1000 ms)
- [ ] On load: drop stale entries
- [ ] `STBL_REGENT_CACHE_MAX_AGE` env binding
- [ ] Test: `test/cache-ttl.test.ts` covers stale + fresh entries

## References

- src/core/cache.ts:DiskCache (Phase 5)
- src/config/schema.ts (cache.{enabled, maxBytes})
- Plan: Phase 5 cache
