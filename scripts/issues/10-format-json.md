## Context

Today: `regent check --format sarif|text|both`. LLM agents would
benefit from a JSON form (not SARIF — simpler) that mirrors the
internal Finding[] shape. Plan called for `--format json`.

## Current behaviour

`regent check --format json`: unknown format, falls back to text.
Exit 1 on parse error from commander.

## Expected behaviour

`regent check --format json` emits:
```json
{
  "rules": [{ "id": "...", "severity": "...", "message": "...", "source": "..." }],
  "findings": [{
    "ruleId": "...",
    "severity": "...",
    "path": "...",
    "match": { "line": 0, "column": 0, "text": "..." },
    "context": { "lines": [...], "startLine": 0, "endLine": 0 },
    "message": "...",
    "source": "...",
    "status": "violation|pending|accepted"
  }],
  "scannedFiles": 42
}
```

Schema mirrors `src/types.ts:RunResult` shape. Stable across versions
or versioned explicitly.

## Acceptance criteria

- [ ] `regent check --format json` emits the documented shape
- [ ] Empty results (no findings) still produce a valid document
- [ ] JSON is parseable by `JSON.parse` without errors
- [ ] Test: `test/format-json.test.ts` validates structure

## References

- src/types.ts:RunResult
- src/cli.ts:runCheck (the format dispatch)
- Plan: Phase 7 CLI surface
