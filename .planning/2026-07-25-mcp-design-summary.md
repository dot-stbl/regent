# MCP server design + prototype — landed 2026-07-25

**Status:** draft PR open, awaiting owner review.

**PR:** https://github.com/dot-stbl/regent/pull/132
**Branch:** `design/mcp-server` @ 6c7cdde
**Issue:** https://github.com/dot-stbl/regent/issues/126
**Design doc:** [2026-07-25-mcp-design.md](./2026-07-25-mcp-design.md)

## What shipped

3 files, 420 insertions:

- `.planning/2026-07-25-mcp-design.md` (316) — full design doc (tool surface, transport, dep choice, state, security, tests, phasing, open questions)
- `src/cli/mcp.ts` (101) — minimal stdio JSON-RPC server implementing `initialize`, `ping`, `tools/list`, `tools/call` + one tool (`regent.list_rules`)
- `src/cli.ts` (+3) — `registerMcpCommand` import + registration call

## Verification (all green)

```
bun run build       # exit 0
bun run typecheck   # exit 0
bun run lint        # exit 0
bun run test        # 666 pass, 5 skipped (no regressions)
node dist/cli.js mcp --help      # shows 'serve' subcommand
node dist/cli.js mcp serve < /tmp/mcp-init.ndjson
# → 3 JSON-RPC responses, 60 rules in tools/call result, exits 0 on EOF
```

## Key design decisions

1. **Hand-rolled JSON-RPC, not the SDK** — `@modelcontextprotocol/sdk@1.29.0` is 4.27 MB unpacked with heavy deps; stdio wire is ~6 methods; 101 lines covers all of them.
2. **stdio only in v1** — no HTTP transport, no SSE, no port binding.
3. **Read-only v1** — `regent.list_rules` ships; `regent.check`, `regent.explain_*`, `regent.suggest_fix`, `regent.status` proposed; write tools deferred to a separate design.

## Open questions for the owner (§11 of the design doc)

1. Tool naming — `regent.<action>` prefix or bare `<action>`?
2. Write-side gating (later PR) — MCP capability or CLI flag?
3. `regent.explain_finding` input shape — object or `"file:line:col"` string?
4. `regent.check` cache opt-out?
5. SDK revisit trigger — current threshold is "HTTP transport or >3 resources/prompts".
6. `serverInfo.version` — track `package.json` or have its own line?

## What this was NOT

- Not the full v1 surface (5 more tools pending owner approval).
- Not tested against a real MCP client (only synthetic stdin JSON-RPC).
- Not reviewed for security beyond "read-only, no execution, no network".
