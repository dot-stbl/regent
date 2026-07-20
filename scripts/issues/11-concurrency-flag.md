## Context

Phase 6 plan: "configurable concurrency per file". Currently
libuv threadpool is implicit. Need explicit `--concurrency` flag
documenting the libuv ceiling and exposing it to users.

## Current behaviour

`Promise.all(files.map(scanFile))` — unbounded. Node defaults to
~4 OS threads. On 32-core boxes, only 4 files in parallel. On
laptops, the cap doesn't matter.

## Expected behaviour

`regent check --concurrency 8` caps the per-file work at 8 in-flight
reads+scans. The flag forwards to a config field that's documented
in `regent llm`. Default: libuv default (4).

## Acceptance criteria

- [ ] `--concurrency N` works; the runner caps the per-file queue
- [ ] Default is 4 (libuv default)
- [ ] `STBL_REGENT_RUNNER_CONCURRENCY` env var also works
- [ ] Test: `test/concurrency.test.ts` verifies the cap is honoured

## References

- src/runner.ts:runRules (Promise.all over files)
- src/config/schema.ts (config field for `runner.concurrency`)
- Plan: Phase 6 concurrency
