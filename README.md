<p align="center">
  <a href="https://github.com/dot-stbl/regent">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/header-dark.svg">
      <img alt="regent by .stbl" src="assets/header-light.svg">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/dot-stbl/regent/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/dot-stbl/regent/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://www.npmjs.com/package/@dot-stbl/regent"><img alt="npm" src="https://img.shields.io/npm/v/@dot-stbl/regent?style=flat-square" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://github.com/dot-stbl/regent/tags"><img alt="GitHub tag" src="https://img.shields.io/github/v/tag/dot-stbl/regent?style=flat-square&label=tag" /></a>
</p>

<details>
<summary><strong>Stars, downloads, contributors</strong></summary>

[![Stars](https://img.shields.io/github/stars/dot-stbl/regent?style=flat-square&label=Stars)](https://github.com/dot-stbl/regent/stargazers)
[![Downloads](https://img.shields.io/npm/dm/@dot-stbl/regent?style=flat-square&label=Downloads/mo)](https://www.npmjs.com/package/@dot-stbl/regent)
[![Contributors](https://img.shields.io/github/contributors/dot-stbl/regent?style=flat-square&label=Contributors)](https://github.com/dot-stbl/regent/graphs/contributors)

</details>
<p></p>

**House-rule static analysis for LLM agents** — detect, fix, review, cache.  
Zero product rules bundled. You (or the agent) author the rules; regent runs them.

Rule kinds:

- **detect** (`.lint.ts`) — match → report (RE2, per-line)
- **ast** — structural match via ast-grep (`needsNative` defers type/symbol work to a native tool)
- **fix** — optional rewrite on a detect/ast rule (`replace` / `delete-line` / `function` / `guidance-only`)
- **transform** / **format** / **delegate** — whole-file rewrites and native-tool wrappers (eslint, `dotnet format`, …)

Our philosophy:

```text
→ native tools first (eslint, dotnet format, ruff, gofmt) not reimplemented linters
→ house rules as TypeScript modules not opaque YAML catalogs
→ one command for agents (check + fix + llm docs) not five CLIs
→ RE2 + AST precision not ReDoS-prone regex soup
```

> [!TIP]
> **Start here:** `bunx @dot-stbl/regent init` scaffolds `tools/audit/`, then  
> `regent llm examples csharp` shows copyable rule packs. Full map → [docs/](docs/README.md).

## See it in action

```text
$ cat src/Worker.cs
public sealed class Worker
{
    public async Task RunAsync()
    {
        await Task.Delay(1).ConfigureAwait(false);
    }
}

$ regent check --all --include-rules "csharp.async.configureawait"
──────────────
  Violations
──────────────
src/Worker.cs:5  error  csharp.async.configureawait
  └─ `.ConfigureAwait(...)` is banned in app code

$ regent fix --rule demo.configure-await --yes
Applied: 1 edit to 1 file

$ cat src/Worker.cs
public sealed class Worker
{
    public async Task RunAsync()
    {
        await Task.Delay(1);
    }
}
```

<details>
<summary><strong>What does a rule file look like?</strong></summary>

A detect rule is a TypeScript module. Optional `fix` tells `regent fix` how to rewrite the match:

```ts
// tools/audit/rules/demo.configure-await.lint.ts
export default {
  id: 'demo.configure-await',
  severity: 'error',
  pattern: '\\.ConfigureAwait\\s*\\(\\s*false\\s*\\)',
  globs: ['**/*.cs'],
  message: '`.ConfigureAwait(false)` is banned in app code.',
  fix: {
    kind: 'replace',
    safety: 'safe',
    title: 'drop ConfigureAwait',
    template: '', // empty template = delete the match
  },
};
```

AST rules use tree-sitter via `@ast-grep` (C#, TypeScript, Rust, Go packs).  
Authoring → [docs/rules.md](docs/rules.md) · agent loop → [docs/agent-workflow.md](docs/agent-workflow.md).

</details>

## Why teams use regent

- **Agent-first** — `regent llm` ships navigable authoring docs; `regent fix --format json` returns `applied` / `suggested` / `deferred` for the agent loop.
- **House rules only** — no opinionated default catalog. ESLint / Biome / Prettier stay; regent layers conventions they cannot express.
- **Regex + AST** — RE2 per-line for text; ast-grep for structure (`private` methods, pure-map `foreach`, …).
- **Safe vs suggested fixes** — mechanical deletes auto-apply; multi-statement rewrites need `--unsafe`.

## Quick Start

**Requires Node.js 20 or higher.** Bun is recommended for development in this repo.

```bash
# Project dependency
bun add -d @dot-stbl/regent

# Or global CLI
bun add -g @dot-stbl/regent

# No install (caches on first use)
bunx @dot-stbl/regent --version
```

```bash
# 1. Scaffold project layout
regent init

# 2. Browse / copy an example rule
regent llm examples csharp
regent example copy csharp csharp.async.configure-await

# 3. Run
regent check --all
regent fix --dry-run          # preview
regent fix --yes              # apply safe-lane fixes
regent fix --unsafe --yes     # also apply suggested / function-form fixes

# 4. Review tri-state findings (if review.enabled on a rule)
regent review
regent accept <rule-id> <path> --reason "tracked in #N"
```

### CLI map

Everyday: `check` · `fix` · `list` · `init` · `llm` · `example copy`  
Power / agent: `diff` · `stats` · `doctor` · `explain` · `describe` · `review` · `accept` · `reject` · `cache` · `benchmark` · `update` · `config` · `bundles` · `mcp` · `check --watch` · `check --annotate-pr`

Full flags → [docs/cli.md](docs/cli.md) · `regent <cmd> --help`.

Config: `.regentrc.ts` (or yaml/json) · layers and env → [docs/config.md](docs/config.md).

## Docs

| Doc | For |
|-----|-----|
| [docs/README.md](docs/README.md) | Full documentation map |
| [docs/architecture.md](docs/architecture.md) | Pipeline, modules, non-goals |
| [docs/cli.md](docs/cli.md) | Every subcommand and flags |
| [docs/rules.md](docs/rules.md) | Writing detect / AST / fix rules |
| [docs/agent-workflow.md](docs/agent-workflow.md) | How agents should call regent |
| [docs/config.md](docs/config.md) | Config files, env, exclude groups |
| [CONTRIBUTING.md](CONTRIBUTING.md) | PR gates, fix purity, fixtures |
| [openspec/](openspec/) | Spec-driven change process |

## vs. alternatives

| Tool | Strength | Where regent differs |
|------|----------|----------------------|
| **ESLint / typescript-eslint** | Mature TS/JS catalog + autofix | Keep it. regent is for multi-language house rules and agent-authored packs, not another TS style guide. |
| **Biome** | Fast format + lint monorepo | Keep Biome for format. regent does not ship a formatter; it can *delegate* to one. |
| **Prettier** | Opinionated format | Orthogonal — regent is not a prettier replacement ([migrating-from-prettier](docs/migrating-from-prettier.md)). |
| **Roslyn / Rider / `dotnet format`** | Deep C# analysis | Prefer native for CA/IDE rules. regent fills house rules no analyzer covers (and can wrap `dotnet format` as a format delegate). |
| **ast-grep CLI alone** | Structural search/rewrite | regent wraps AST + RE2 + review + cache + agent JSON in one tool. |
| **OpenSpec** | Spec-driven change workflow | Complementary — this repo uses [OpenSpec](openspec/) for proposals; regent enforces code conventions. |

## Usage notes

- **Flags:** `regent fix` uses `--yes`, `--dry-run`, `--unsafe` (not the older `--write` / `--check` wording). When in doubt: `regent fix --help`.
- **Version skew:** a checkout’s `package.json` may lag the published npm tag. `regent --version` and [npm](https://www.npmjs.com/package/@dot-stbl/regent) are authoritative for what you installed.
- **Per-line RE2:** multi-line regex is not supported. Compose per-line patterns + `excludeWhen`, or use an AST rule.
- **Log hygiene:** findings go to stdout; operational logs to stderr. Never log `matchText` (may contain secrets) — use `safeLog()` from the public API.
- **Zero bundled rules:** `regent check` on a bare project reports nothing until you add rules under `tools/audit/rules/` or extend a global pack (e.g. `~/.agents/rules/csharp/regent-rules`).

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run build
node dist/cli.js --help
```

Contributing → [CONTRIBUTING.md](CONTRIBUTING.md). Issues → [dot-stbl/regent](https://github.com/dot-stbl/regent/issues).

## Status

| | |
|---|---|
| License | MIT |
| Runtime | Node ≥ 20 (Bun recommended for this repo) |
| Matching | RE2 (`re2-wasm`) + ast-grep language packs |
| Rule kinds | detect · ast · fix attachment · transform · format/delegate |
| Agent surface | `regent llm`, fix JSON v1 (`applied` / `suggested` / `deferred`), optional MCP |

## Related

- [docs/](docs/README.md) — full documentation
- [openspec/](openspec/) — capability specs and change proposals
- [dot-stbl brand](https://github.com/dot-stbl/brand) — design kit
- [dot-stbl org](https://github.com/dot-stbl) — sibling projects

---

<sub><code>regent</code> is built by <a href="https://github.com/dot-stbl">.stbl</a>.</sub>
