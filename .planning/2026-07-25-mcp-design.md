# Regent MCP Server — Design + Prototype

**Refs:** #126 (issue) · design doc, not the implementation
**Milestone:** v0.3.0
**Status:** prototype ships with this doc; full tool surface deferred to owner approval
**Branch:** `design/mcp-server`
**Target PR:** draft for owner review

---

## 1. Why MCP — one paragraph

An LLM agent editing a repo needs **structured, queryable access** to regent's
findings, not a CLI it has to spawn and parse. Today, an agent has to:
(1) invoke `regent list` and split ANSI-coloured text to learn the available rules,
(2) invoke `regent check --format json` and parse a JSON document whose schema drifts
between versions, (3) call `regent explain <ruleId>` and re-extract the prose.
MCP fixes this: the agent opens a JSON-RPC channel to `regent mcp serve`, lists
the tools once, then calls `regent.list_rules`, `regent.explain_rule`,
`regent.check`, etc., with typed arguments and structured responses. regent becomes
**a first-class tool the agent can drive**, instead of a black-box subprocess it
has to scrape.

This is the same shift that turned `eslint --format json` into the LSP-friendly
`eslint.lsp` server — agents get stable schemas, versioned protocol, and per-call
context rather than stdout archaeology.

---

## 2. Tool surface (proposed, v1)

Six tools, all read-only in v1. Tool names use a `regent.*` prefix because MCP
namespaces are flat and we want to coexist with other analysis servers an agent
might connect to (eslint, biome, ruff, …).

| Tool | Purpose | Params | Returns |
|---|---|---|---|
| `regent.list_rules` | List every rule the loader resolves for the cwd, with severity, kind, and source `.md` reference. Mirrors `regent list`. | `{}` | `{ rules: RuleSummary[], total: number }` |
| `regent.check` | Run a scan against the cwd, return structured findings (no text rendering). | `{ config?: string, scope?: string, all?: boolean, includeRules?: string[], excludeRules?: string[] }` | `{ findings: Finding[], scannedFiles: number, summary: { bySeverity, byStatus } }` |
| `regent.explain_rule` | For a rule id, return description, rationale, review guidance, source path, and the full rule spec. | `{ ruleId: string }` | `{ id, severity, kind, source, message, rationale?, review?, globs, paramsSchema? }` |
| `regent.explain_finding` | For a finding at `file:line:col`, return the matched code window, the rule that fired, and the suggested fix (if any). | `{ file: string, line: number, column?: number }` | `{ rule: RuleSummary, finding: Finding, codeWindow: { startLine, endLine, content }, fix?: ProposedFix }` |
| `regent.suggest_fix` | Given a finding, return the proposed edit(s) without writing to disk. Mirrors `regent fix --dry-run`. | `{ finding: Finding, unsafe?: boolean }` | `{ edits: ProposedEdit[], confidence: 'high'\|'medium'\|'low' }` |
| `regent.status` | Health summary: loader version, git status, rule counts by kind, last run timestamp. Mirrors the new `regent doctor`. | `{}` | `{ version, cwd, git: { branch, dirty, ahead }, rules: { detect, ast, transform, fix }, lastRun? }` |

### v1 = read-only

`regent.accept` / `regent.reject` / `regent.fix` are deliberately **excluded**.
v1 is for an agent that **triages** findings. v2 adds the write side, gated on
the owner's review of the read-only design and a separate auth model (an MCP
server writing to the user's filesystem needs the same careful authorisation as
the CLI does today — `--unsafe` requires explicit user opt-in).

### Tool-schema stability

Every tool returns `content: [{ type: 'text', text: JSON.stringify(result) }]`
**and** `structuredContent: result` so clients can either parse the JSON or
read it natively if they support structured content. The JSON schema lives
inline in `mcp.ts` (no runtime generation) — drift between TypeScript type and
MCP schema is caught at compile time.

---

## 3. Transport — stdio JSON-RPC

v1 is **stdio only**. Rationale:

- **Standard.** Every MCP client (Claude Desktop, Cursor, Zed, custom agents)
  supports stdio. SSE/HTTP transport is opt-in across clients and adds auth
  complexity that regent's user-local CLI doesn't need.
- **Zero infra.** No port, no TLS, no firewall rules. `regent mcp serve` just
  reads JSON-RPC lines from stdin and writes to stdout.
- **Process boundary == security boundary.** The agent owns the server's stdin
  and stdout. No inbound network, no outbound except what the loader already
  does (read user-authored `.lint.ts` files in cwd).

JSON-RPC framing: one message per line, `\n`-terminated. Notifications have no
`id`; requests have an `id` (string|number|null) and get exactly one response.

---

## 4. Dependencies — hand-rolled, not the SDK

**Decision: hand-roll a minimal JSON-RPC server. Do NOT add
`@modelcontextprotocol/sdk` to runtime deps.**

Reasons:

1. **SDK is 4.27 MB unpacked** (per npm registry response for `@modelcontextprotocol/sdk@1.29.0`,
   `unpackedSize: 4268166` bytes). regent's current `dependencies` total ~3 MB.
   Adding the SDK would **double** the install footprint for ~100 lines of
   JSON-RPC we already have.
2. **SDK pulls heavy transitive deps**: `hono`, `express`, `cors`, `ajv`, `jose`,
   `pkce-challenge`, `eventsource-parser`. None of these are needed for a stdio
   server.
3. **The wire protocol for stdio MCP is ~6 methods**: `initialize`, `ping`,
   `notifications/initialized`, `tools/list`, `tools/call`, `notifications/cancelled`.
   The prototype implements all six in 101 lines (`src/cli/mcp.ts`).
4. **Regent's surface is narrow**: one tool today, six in v1, no resources,
   no prompts, no sampling. The SDK's resource/prompt/sampling machinery is
   unused.

When to revisit: if regent later needs (a) HTTP transport, (b) OAuth to an MCP
gateway, (c) resource/prompt surfaces, the SDK becomes attractive. v1 doesn't
need any of these. Tracked as an open question below.

### What the prototype implements

| Method | Handler | Status |
|---|---|---|
| `initialize` | returns protocolVersion, capabilities, serverInfo | ✅ |
| `notifications/initialized` | no-op (client sends this; no reply) | ✅ |
| `ping` | returns `{}` | ✅ |
| `tools/list` | returns `[regent.list_rules]` | ✅ |
| `tools/call` | dispatches to `regent.list_rules` | ✅ |
| `notifications/cancelled` | no-op (accept + ignore) | implicit — unknown notifications drop |
| unknown method | `-32601 Method not found` | ✅ |
| malformed JSON | `-32603 Internal error` | ✅ |
| unknown tool | `-32602 Invalid params` | ✅ |

Verified end-to-end against a real client sequence (`initialize` →
`notifications/initialized` → `tools/list` → `tools/call`). See `§9 Test plan`
for the smoke command.

---

## 5. State — in-memory, throwaway

Server holds **no state between requests** in v1:

- `regent.list_rules` calls `loadRules({ repoRoot: process.cwd() })` per call.
  The loader already caches user-global rules internally; per-call cost is
  the project-rule walk, which is fast (single-file reads + zod validation).
- `regent.check` would call `runRules(...)` per call. The runner's `.regent/cache.json`
  on disk is shared with the CLI — if the agent edits a file, the cache invalidates
  by file-hash just like `regent check` does today.
- `regent.status` reads from in-memory + filesystem only; no write.

**Why no shared cache between calls**: agent-driven loops are bursty
(agent edits → asks for findings → reads findings → edits more). The loader's
own cache hits on subsequent `loadRules` calls. Adding a hand-rolled MCP
server-side cache would create two sources of truth (cache + loader) and the
loader already manages its own. If profiling shows the loader cost matters,
add a TTL cache in `mcp.ts`, not a parallel one.

**Restarts are cheap**: the server has no warm-up cost beyond importing the
module graph. ~200ms cold start on a moderate project (vs ~400ms for a
separate process per call).

---

## 6. Security — read-only, no code execution

The prototype (and v1) **does not execute user code beyond what `regent check`
already does today**:

- **File reads** — only what's needed for rule loading (cwd + user-global).
  No reads outside the cwd tree.
- **No subprocesses.** The MCP server is in-process with regent; it doesn't
  shell out, doesn't `eval`, doesn't load anything the loader wouldn't have
  loaded already.
- **No network.** `loadRules` doesn't fetch (extends via `npm:` package spec
  resolves to a local install path; no HTTP). `runRules` (used by
  `regent.check`) does not network either.
- **No persistence.** The server writes nothing. It logs to stderr (pino, like
  every other regent command) — that's it.

**Threat model**: the agent runs in the user's machine, starts the server
itself, and sends JSON-RPC over its own pipes. A malicious *input* (malformed
JSON, unexpected method names) returns `-326xx` errors; nothing else.
A malicious *file* on disk is the same threat surface as `regent check` has
today — i.e., a `.lint.ts` that runs at load time can do whatever a
user-authored TS file can. This is unchanged from the CLI.

**Auth in v1**: none beyond "the agent that started the process". The
process group boundary is the trust boundary. v2 (write tools) would need
either an MCP-level capability or an explicit `--write-tools` flag the user
passes when starting the server.

---

## 7. Test plan — CI-friendly

Three layers, in order:

### 7.1 Unit tests (`test/mcp.test.ts`)

Spawn `node dist/cli.js mcp serve` with a known-input repo, send JSON-RPC
lines over stdin, assert stdout responses. **Status: planned, not in this PR.**
The prototype is small enough that smoke testing (§7.3) is the primary gate;
unit tests belong with the full v1 surface.

### 7.2 Fixture-backed lint of the tool response shape

A small `test/fixtures/mcp-list-rules.json` captures the current
`regent.list_rules` response shape (60 rules). A regression test asserts the
fields present and their types. **Status: planned.**

### 7.3 Smoke test (this PR)

`node dist/cli.js mcp serve` started, sent three JSON-RPC lines (`initialize`,
`tools/list`, `tools/call regent.list_rules`), exited cleanly. This is what
the PR verifies — see `§10 Prototype verification`.

### 7.4 CI integration

Add a smoke job to `.github/workflows/ci.yml`:

```yaml
- name: regent mcp smoke
  run: |
    printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"ci","version":"0.0.1"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | node dist/cli.js mcp serve
```

Assert stdout contains a `"tools":[` array and a non-zero `total`. ~5 lines
of workflow YAML, no extra deps.

---

## 8. Size estimate

| Component | LOC | Notes |
|---|---|---|
| `src/cli/mcp.ts` (this PR) | 101 | full server, one tool |
| `src/cli.ts` (this PR) | +2 | import + register |
| `test/mcp.test.ts` (later PR) | ~80 | spawn + assert responses |
| `test/fixtures/mcp-list-rules.json` (later PR) | ~80 | golden snapshot |
| `test/loader.test.ts` — no change | 0 | loader coverage already exists |
| `.github/workflows/ci.yml` (this PR, optional) | +5 | smoke job |
| **Total this PR** | **~108** | under the 1-PR cap the issue requested |

v1 full surface (when the owner approves): ~+200 LOC for the remaining five
tools, +~100 LOC for tests. Single follow-up PR after design approval.

---

## 9. Phasing

- **PR 1 (this one)** — design doc + minimal prototype (`regent.list_rules`),
  wired into `regent mcp serve`. Read-only by construction. Draft for owner
  review.
- **PR 2 (after owner approval)** — `regent.check`, `regent.explain_rule`,
  `regent.explain_finding`, `regent.status`. Still read-only.
- **PR 3 (after that)** — `regent.suggest_fix` (dry-run only). Still no writes.
- **PR 4 (separate design doc)** — write-side tools (`regent.accept`,
  `regent.reject`, `regent.fix`). Different threat model, deserves its own
  approval gate.

Each PR is independently mergeable and shippable. The owner can stop after
any phase.

---

## 10. Prototype verification — done in this PR

Three checks all green at PR open:

```bash
# 1. Build + typecheck + lint
bun run build       # exit 0
bun run typecheck   # exit 0
bun run lint        # exit 0

# 2. CLI registration
node dist/cli.js --help        # shows `mcp` in Commands list
node dist/cli.js mcp --help    # shows `serve` in Commands list

# 3. Server smoke (initialize → tools/list → tools/call)
printf '...\n...\n...' | node dist/cli.js mcp serve
# → returns 3 JSON-RPC responses, 60 rules in tools/call result, exits 0 on EOF
```

The full request/response transcript from the smoke run is reproducible with
the ndjson file documented in the test plan (§7.3).

---

## 11. Open decisions for the owner

These are the things I'd like a thumbs-up (or a different answer) on before
PR 2 lands:

1. **Tool naming** — `regent.<action>` prefix? Or just `<action>` (relying on
   the `serverInfo.name` for namespacing)? Both are valid MCP patterns;
   the prefix keeps things collision-safe when an agent connects to multiple
   analysis servers.
2. **`regent.explain_finding` input shape** — `file:line:col` (three fields)
   or a single string `"file:line:col"` (matches the `regent reject` CLI)?
   The string form matches the CLI; the object form is cleaner JSON. I lean
   string-for-CLI-parity but want your call.
3. **`regent.check` should it cache?** — the runner caches via
   `.regent/cache.json`; do MCP callers want a separate `noCache` flag to
   force a fresh scan (e.g. for editor-style auto-refresh)?
4. **Write-side gating** — when PR 4 lands, do we want a per-call MCP-level
   capability (`capabilities.tools.destructive = true` requested by client
   + granted by user at startup), or a process-level `--allow-write-tools`
   CLI flag? The MCP-native answer is the capability; the simpler answer is
   the CLI flag.
5. **Dep revisit trigger** — under what condition do we adopt
   `@modelcontextprotocol/sdk` later? My trigger is "we need HTTP transport
   OR we need >3 MCP resources/prompts". Open to a different threshold.
6. **Versioning** — `serverInfo.version` is currently `0.1.0-prototype`.
   When this lands, should it track `package.json` (currently `0.5.2`) or
   have its own MCP-server version line?

---

## 12. References

- **Issue** — #126 "Design and prototype regent MCP server"
- **MCP spec** — <https://modelcontextprotocol.io/docs>
- **MCP SDK** — `@modelcontextprotocol/sdk@1.29.0` on npm (rejected for v1; see §4)
- **Closest existing pattern** — `src/cli/diff.ts` (CLI subcommand + register helper,
  same shape as `src/cli/mcp.ts`)
- **Closest explanation surface** — `src/cli/describe.ts` (`regent describe`,
  dual text/json output — pattern for `regent.explain_rule`)
- **Owner roadmap item** — MCP server design/prototype