# regent documentation

Human-facing docs for `@dot-stbl/regent`. For agent-oriented prose and schemas, use `regent llm` / `assets/llm/`. For contribution workflow, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Map

| Page | One-line | When to read |
|------|----------|--------------|
| [architecture.md](./architecture.md) | Engine pipeline, rule kinds, modules, cache, config layers, non-goals | Understanding how regent is built or where to change core behavior |
| [cli.md](./cli.md) | Subcommands, important flags, exit codes, version skew | Running or scripting the CLI; CI gates |
| [rules.md](./rules.md) | Detect / AST / fix attachment / RE2 / fixtures / load paths | Authoring or reviewing a rule |
| [config.md](./config.md) | `.regentrc`, layers, `STBL_REGENT_*`, exclude groups, cache path | Wiring a project or debugging “why didn’t it load?” |
| [agent-workflow.md](./agent-workflow.md) | Agent loop, JSON/SARIF, fix v1 wire format, `regent llm`, native-vs-regent | Building an agent integration or CI agent step |
| [migrating/README.md](./migrating/README.md) | Why layer vs replace stock linters; zero bundled rules | Deciding whether regent fits your stack |
| [migrating-from-eslint.md](./migrating-from-eslint.md) | Keep ESLint’s library; add regent for house rules | ESLint already in the repo |
| [migrating-from-biome.md](./migrating-from-biome.md) | Keep Biome for format; regent for agent-authored audit | Biome monorepo / format+lint combo |
| [migrating-from-prettier.md](./migrating-from-prettier.md) | Prettier and regent do not compete (no built-in formatter) | “Can regent replace prettier?” |

## Spec-driven (OpenSpec)

| Location | Role |
|----------|------|
| [openspec/config.yaml](../openspec/config.yaml) | Project context + artifact rules for OpenSpec |
| [openspec/specs/](../openspec/specs/) | Capability specs (`static-analysis`, `auto-fix`, `agent-contract`) |
| [openspec/changes/](../openspec/changes/) | Active change proposals (empty until `/opsx:propose`) |

```sh
openspec list --specs
openspec view
```

## Quick start (docs path)

1. Install and scaffold — root [README.md](../README.md) and `regent init`.
2. [cli.md](./cli.md) — `check` / `fix` / `review`.
3. [rules.md](./rules.md) — author a house rule.
4. [architecture.md](./architecture.md) — kinds and discovery if you change the engine.
5. Migration guides if you already run ESLint / Biome / Prettier.

## Outside `docs/`

| Location | Role |
|----------|------|
| [README.md](../README.md) | Package landing |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Authoring rules, fix purity, format/delegate |
| [CHANGELOG.md](../CHANGELOG.md) | Release history |
| [AGENTS.md](../AGENTS.md) | Issue tracking conventions for agents |
| `assets/llm/` | LLM skill pages (`regent llm …`) |
| `examples/<lang>/` | Copyable example rules (not auto-loaded) |
| `skills/regent/` | Packaged agent skill |

## Accuracy note

These docs are written against the **source tree** under `src/`. Published npm versions and the CLI `VERSION` string can lag each other — see [cli.md](./cli.md#version-skew). When flags disagree, `regent <cmd> --help` wins.
