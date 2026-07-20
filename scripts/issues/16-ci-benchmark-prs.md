## Context

Phase 14 added the benchmark job but only configured it to run
on `push` to `main`. PRs should also run the benchmark so
regressions are caught before merge, not after.

## Current behaviour

PRs get the `test` job (typecheck, lint, vitest, smoke) but
not the `benchmark` job. A 2x perf regression in a PR lands
unreviewed.

## Expected behaviour

- benchmark job runs on every PR AND every push
- PR failure on benchmark regression blocks merge
- The 50% delta threshold is conservative; we may tighten once
  we have data points

## Acceptance criteria

- [ ] Verify workflow triggers — adjust if benchmark only runs
      on push-to-main
- [ ] Open a test PR and confirm benchmark job runs
- [ ] Document the regression threshold (50%) in the workflow
      comments

## References

- .github/workflows/ci.yml:benchmark job
- Plan: Phase 14 CI hardening
