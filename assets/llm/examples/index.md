# Examples

Curated rule examples. Each is a real, working `.lint.ts` (or
`.fix.ts`) file shipped under `examples/<lang>/`. Use them as
templates for your own rules.

| Language | Examples |
|----------|----------|
| [`csharp`](./csharp/index.md) | C# — naming, async, exceptions, HTTP, regions |
| [`typescript`](./typescript/index.md) | TypeScript — banned types, console |
| [`python`](./python/index.md) | Python — type hints |
| [`rust`](./rust/index.md) | Rust — unsafe-block, unwrap-in-prod |
| [`java`](./java/index.md) | Java — empty catch, system-out |
| [`go`](./go/index.md) | Go — panic, fmt-print |
| [`meta`](./meta/index.md) | language-agnostic — file hygiene, formatting |

Browse:

```
regent llm examples csharp
regent llm examples csharp.no-todo-without-owner
```

Copy into a project:

```
regent example copy csharp no-todo-without-owner
```
