## Context

Plan deferred: chokidar + debounce, re-execute scan on file
change. Cache makes warm restarts cheap.

## Current behaviour

`regent check` exits when done. To re-run after edit, user must
re-invoke manually.

## Expected behaviour

- `regent check --watch` runs the scan, then watches cwd
- chokidar with 100ms debounce per file
- on change: invalidate cache for that file, re-run the scan
- on Ctrl-C: clean exit
- on error: keep watching, don't crash
- summary line after each iteration (X files, Y findings, Z ms)

## Acceptance criteria

- [ ] `--watch` flag runs the scan, then watches
- [ ] On file change: re-scan within 200ms
- [ ] Ctrl-C exits cleanly
- [ ] Cache is invalidated per file
- [ ] Test: `test/watch.test.ts` (writes a file, watches for
      re-scan event — flakier, may need longer timeout)

## References

- Plan: Phase 7 CLI surface (deferred to v0.3+)
