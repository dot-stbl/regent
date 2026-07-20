## Context

`STBL_REGENT_OUTPUT_CONTEXT_BUFFER` is parsed by
`src/config/sources/env.ts` into `config.output.contextBuffer` but
the runner reads the constant `DEFAULT_CONTEXT_BUFFER` from
`src/constants.ts` directly. The env var is silently ignored.

## Current behaviour

```
$ STBL_REGENT_OUTPUT_CONTEXT_BUFFER=5 regent check --all
```

Finding context window still uses 3 lines (the constant),
regardless of the env var. The config field is computed but not
consumed.

## Expected behaviour

- Runner reads `output.contextBuffer` from the resolved config
- Findings render with that many lines before/after the match
- Default 3 (unchanged for users who don't set the env var)
- Reject values outside 0..50 (Zod already does this)

## Acceptance criteria

- [ ] Runner reads `contextBuffer` from the resolved config
- [ ] `STBL_REGENT_OUTPUT_CONTEXT_BUFFER=5` → findings show 5 lines
- [ ] Default 3 unchanged
- [ ] Test: `test/context-buffer.test.ts` covers the wiring

## References

- src/config/sources/env.ts (output.contextBuffer parsing)
- src/constants.ts:DEFAULT_CONTEXT_BUFFER (currently the source)
- src/runner.ts:runRules (hardcoded constant today)
