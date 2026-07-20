## Context

Companion to #18 — the `transform(file, content) → string`
contract. Caller is responsible for emitting the new file content.
Should be the LAST step in the pipeline (detect → fix → transform).

## Current behaviour

No transform execution at all (see #18).

## Expected behaviour

- transform rules are LAST in the pipeline order
- runner reads file once, runs detect + fix on the in-memory
  content, then runs transform on the fixed content
- transform output becomes the candidate new file
- if any transform changed content: `regent fix --write` writes
  the transformed version
- for `regent fix --check`: diff is original → transformed

## Acceptance criteria

- [ ] Transform runs after fix, not before
- [ ] Diff is original-vs-transformed (not original-vs-fixed)
- [ ] Test: `test/transform-after-fix.test.ts` end-to-end

## References

- src/core/scanner-matcher.ts:scanFileWithMatcher (transform
  could reuse this for input matching if it wants)
- Plan: Phase 3 multi-mode kinds
