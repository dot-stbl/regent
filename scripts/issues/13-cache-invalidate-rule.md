## Context

`DiskCache.invalidate({ fileHash })` is wired; invalidate by rule
(`{ ruleId }`) is documented but not implemented. A spec bump
shouldn't have to flush the entire cache.

## Current behaviour

`invalidate({ ruleId })`: not implemented. Spec bumps force a
full reload from disk. Wasted work.

## Expected behaviour

- `invalidate({ ruleId })` drops all entries whose key includes
  the ruleId (the key is composite: `fileHash|ruleHash|ruleKind`)
- Iterate all keys, check ruleId match, delete
- The runner calls `invalidate({ ruleId })` when a rule's spec
  hash changes between runs

## Acceptance criteria

- [ ] `invalidate({ ruleId })` drops matching entries only
- [ ] Other rules' entries preserved
- [ ] Test: `test/cache-invalidate-rule.test.ts`

## References

- src/core/cache.ts:DiskCache.invalidate (fileHash only today)
- Plan: Phase 5 cache
