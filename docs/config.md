# Configuration reference

regent config is layered, Zod-strict (unknown keys fail at load), and loaded via cosmiconfig + env + CLI.

Source: `src/config/` (`schema.ts`, `index.ts`, `sources/*`, `groups.ts`, `merge.ts`).

---

## Config file names

### Project (walks up from cwd)

| File | Notes |
|------|--------|
| `.regentrc.ts` / `.js` / `.mjs` / `.cjs` | Preferred TS/JS |
| `.regentrc.json` / `.yaml` / `.yml` | Data-only |
| `regent.config.ts` / `.js` / … | Alternate basename |
| `package.json` → `"regent"` field | Cosmiconfig package key |

### Per-developer (gitignored, higher than project)

| File |
|------|
| `.regentrc.local.ts` / `.js` / `.mjs` / `.cjs` / `.json` / `.yaml` / `.yml` |

### User-global

| Path |
|------|
| `~/.config/regent/config.{ts,js,json,…}` (same search places under that directory) |

### Legacy

| Path | Notes |
|------|--------|
| `tools/audit/config.ts` | Still used as default `--config` on several CLI commands |
| `tools/audit/config.local.ts` | Local accept / overrides |
| `regent migrate` | Helps move legacy → `.regentrc.ts` |

Export shape for TS:

```ts
import { defineConfig, defineDetectRule } from '@dot-stbl/regent';

export default defineConfig({
  rules: {
    detect: [/* defineDetectRule({...}) */],
    fix: [],
    ast: [],
    extends: [],
    disable: [],
    override: {},
    configure: {},
    accept: [],
  },
  excludePaths: ['@generated'],
  excludeGroups: {},
  cache: { enabled: true },
  log: { level: 'info', format: 'text' },
  output: { color: true, contextBuffer: 3 },
  runner: { concurrency: 4 },
});
```

---

## Layer precedence (low → high)

From `loadConfig()` (`src/config/index.ts`):

1. **defaults** — built-in (`sources/defaults.ts`)
2. **global** — `~/.config/regent/…`
3. **project** — `.regentrc.*` / `package.json#regent`
4. **local** — `.regentrc.local.*`
5. **env** — `STBL_REGENT_*` (+ optional cwd `.env`, shell wins over `.env`)
6. **args** — CLI flags (`--log-level`, `--no-cache`, …)

Inspect: `regent config` / layer listing when available; warnings for invalid layers are non-fatal where possible.

---

## `STBL_REGENT_*` environment variables

From `src/config/sources/env.ts`:

| Env var | Config path | Notes |
|---------|-------------|--------|
| `STBL_REGENT_LOG_LEVEL` | `log.level` | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` |
| `STBL_REGENT_LOG_FORMAT` | `log.format` | `text` \| `json` |
| `STBL_REGENT_CACHE_ENABLED` | `cache.enabled` | bool |
| `STBL_REGENT_CACHE_MAX_BYTES` | `cache.maxBytes` | integer bytes |
| `STBL_REGENT_CACHE_MAX_AGE` | `cache.maxAge` | **seconds** in env → stored as **ms** in config |
| `STBL_REGENT_OUTPUT_COLOR` | `output.color` | bool |
| `STBL_REGENT_OUTPUT_CONTEXT_BUFFER` | `output.contextBuffer` | integer lines (0–50) |
| `STBL_REGENT_RUNNER_CONCURRENCY` | `runner.concurrency` | positive integer |

Bool parsing (case-insensitive): `true` / `false` / `1` / `0` / `yes` / `no` / `on` / `off`. Bad values throw at load.

Also used outside the Zod config object:

| Env var | Role |
|---------|------|
| `STBL_REGENT_GLOBAL_RULES_PATH` | Override user-global rule root (default `~/.agents/rules`) — tests / sandboxes |

Unknown `STBL_REGENT_*` keys are ignored (forward-compatible).

---

## Top-level config fields

| Field | Default (approx.) | Purpose |
|-------|-------------------|---------|
| `rules` | empty arrays / objects | See below |
| `excludePaths` | `[]` | Project-wide exclude globs + `@group` |
| `excludeGroups` | `{}` | User-defined named groups (kebab-case names) |
| `cache.enabled` | `true` | Disk cache |
| `cache.maxBytes` | `100 * 1024 * 1024` | LRU size cap |
| `cache.maxAge` | 7 days (ms) | Entry TTL |
| `log.level` | `info` | pino level |
| `log.format` | `text` | `text` or `json` |
| `output.color` | `true` | ANSI in text reporter |
| `output.contextBuffer` | `3` | Lines of context around matches |
| `runner.concurrency` | `4` | Parallel file scans |

---

## `rules` section

| Key | Purpose |
|-----|---------|
| `detect[]` | Inline detect rules (`defineDetectRule` / `RuleSpec`) |
| `fix[]` | Inline standalone fix rules (`find` / `replace`) |
| `ast[]` | Inline AST rules (`defineAstRule`) |
| `transform[]` | Transform rule metadata (loaded; runner pipeline follow-up) |
| `format[]` | Format tool specs (mutating CLI wrappers) |
| `delegate[]` | Delegate tool specs (read-only CLI wrappers) |
| `extends[]` | Paths, globs, npm package names, or inline rule arrays |
| `disable[]` | Rule ids to drop from the merged set |
| `override{}` | Per-id `{ severity?, message? }` |
| `configure{}` | Per-id params for parameterised rules |
| `accept[]` | Accept-list entries for review-mode findings |

### Accept entry

```ts
{
  ruleId: string;
  path: string;      // glob against absolute path
  line?: number;     // optional pin
  reason: string;    // required, max 500
}
```

### Extends / plugins

`rules.extends` resolution (`src/loader/plugin-extends.ts`): path/glob, npm package specs, or inline arrays. There is **no** separate top-level `plugins` key — plugins enter through `extends` and file discovery. Format/delegate discovery is file-based (`*.format.ts` / `*.delegate.ts`) plus inline arrays.

---

## Exclude groups

Built-ins and `@` references: see [rules.md](./rules.md#excludepaths-and-named-groups) and `src/config/groups.ts`.

User `excludeGroups` keys: `^[a-z][a-z0-9-]*$`. Overriding a built-in name emits a warning.

---

## Cache location

| Path | Role |
|------|------|
| `.regent/cache.json` | Content-hash / rule-hash disk cache (atomic write, LRU, TTL) |

Commands: `regent cache stats`, `regent cache clear`. Disable: `cache.enabled: false`, `STBL_REGENT_CACHE_ENABLED=false`, or CLI `--no-cache` (where supported).

Schema version stamps invalidate entries when the engine format changes.

---

## Rule file discovery (not config files)

Independent of cosmiconfig, the loader also scans:

1. `~/.agents/rules/**` (or `STBL_REGENT_GLOBAL_RULES_PATH`)
2. `<repo>/tools/audit/rules/**`
3. `<repo>/tools/audit/*.{format,delegate}.ts`

See [rules.md](./rules.md#where-rules-are-loaded).

---

## Related

- [Rule authoring](./rules.md)
- [Agent workflow](./agent-workflow.md)
- `src/config/schema.ts` — Zod authority
- OpenSpec: static-analysis / auto-fix / agent-contract
