// Multi-page router for `regent llm [subcommand] [...]`.
//
// The CLI subcommand dispatches here based on the subcommand tree.
// We surface a single, predictable error when a sub-path is missing
// so an LLM agent can read the message and follow up.

import { loadLlmDoc, loadLlmJson, tryResolveLlmPath } from './llm.js';

export type RouterResult =
  | { kind: 'ok'; content: string; path: string }
  | { kind: 'error'; message: string };

/**
 * Route table — prefix + the asset path. `schema fix` is the v1
 * OUTPUT schema (P5 #62); `schema fix-rule` and `schema detect-rule`
 * are the existing RULE-spec markdown (with `--json` for the JSON
 * schema emitter in `src/llm-schema.ts`). The split keeps
 * `regent llm schema fix` (the most common agent request — the
 * output shape) on a short, predictable name.
 */
const ROUTES: ReadonlyArray<{ prefix: string; path: string; help: string }> = [
  { prefix: 'authoring detect', path: 'authoring/detect.md', help: 'authoring detect' },
  { prefix: 'authoring fix', path: 'authoring/fix.md', help: 'authoring fix' },
  { prefix: 'authoring', path: 'authoring/index.md', help: 'authoring <kind>' },
  { prefix: 'schema detect-rule', path: 'schema/detect.md', help: 'schema detect-rule' },
  { prefix: 'schema fix-rule', path: 'schema/fix.md', help: 'schema fix-rule' },
  { prefix: 'schema detect', path: 'schema/detect.md', help: 'schema detect (alias of detect-rule)' },
  { prefix: 'schema fix', path: 'schema/fix-v1.json', help: 'schema fix (v1 output schema)' },
  { prefix: 'schema', path: 'schema/index.md', help: 'schema <name>' },
  { prefix: 'examples', path: 'examples/index.md', help: 'examples <lang>[.<rule>]' },
];

/**
 * Build a one-page catalog of every route the router can resolve.
 * Surfaced when an agent runs `regent llm` with no subcommand or
 * when `regent llm schema` is called bare — they need a quick map of
 * what's available without re-reading the index.md file.
 */
function buildSchemaCatalog(): string {
  const entries: { name: string; help: string; kind: 'json' | 'markdown' }[] = [];
  for (const route of ROUTES) {
    if (!route.prefix.startsWith('schema ')) {
      continue;
    }
    const name = route.prefix.slice('schema '.length);
    const kind: 'json' | 'markdown' = route.path.endsWith('.json') ? 'json' : 'markdown';
    entries.push({ name, help: route.help, kind });
  }
  // Stable order — most useful first.
  const order = ['fix', 'fix-rule', 'detect', 'detect-rule'];
  entries.sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    if (ai === -1 && bi === -1) {
      return a.name.localeCompare(b.name);
    }
    if (ai === -1) {
      return 1;
    }
    if (bi === -1) {
      return -1;
    }
    return ai - bi;
  });
  const lines: string[] = [];
  lines.push('# regent llm schema — available schemas');
  lines.push('');
  lines.push('| Schema | Format | Description |');
  lines.push('|--------|--------|-------------|');
  for (const e of entries) {
    const description = e.name === 'fix'
      ? 'v1 fix OUTPUT schema (what `regent fix --format json` emits)'
      : e.name === 'fix-rule'
        ? 'fix-rule spec (what `config.rules.fix[]` entries look like)'
        : e.name === 'detect'
          ? 'detect-rule spec (alias of `detect-rule`)'
          : 'detect-rule spec (what `config.rules.detect[]` entries look like)';
    lines.push(`| \`schema ${e.name}\` | ${e.kind} | ${description} |`);
  }
  lines.push('');
  lines.push('Use `regent llm schema fix` to fetch the v1 fix-output JSON Schema.');
  return `${lines.join('\n')}\n`;
}

/**
 * Resolve a subcommand tree (e.g. `['authoring', 'detect']`) to the
 * matching markdown file. Returns an `ok` result with the file's
 * contents, or an `error` with a human-readable message + available
 * subcommands.
 */
export function routeLlm(subArgs: readonly string[]): RouterResult {
  if (subArgs.length === 0) {
    return { kind: 'ok', content: loadLlmDoc('index.md'), path: 'index.md' };
  }

  // `regent llm schema` (no name) → schema catalog.
  if (subArgs.length === 1 && subArgs[0] === 'schema') {
    return { kind: 'ok', content: buildSchemaCatalog(), path: '<schema-catalog>' };
  }

  const joined = subArgs.join(' ');

  for (const route of ROUTES) {
    if (route.prefix === joined) {
      try {
        if (route.path.endsWith('.json')) {
          // JSON schemas pass through `JSON.parse` then re-emit with
          // 2-space indentation so the output matches the markdown
          // emitter style (the file on disk is unindented; the CLI
          // is the canonical renderer for agent consumption).
          const parsed = loadLlmJson(route.path);
          return {
            kind: 'ok',
            content: `${JSON.stringify(parsed, null, 2)}\n`,
            path: route.path,
          };
        }
        return { kind: 'ok', content: loadLlmDoc(route.path), path: route.path };
      } catch (err) {
        return { kind: 'error', message: (err as Error).message };
      }
    }
  }

  // Examples subcommand: examples <lang> or examples <lang>.<rule>
  if (subArgs[0] === 'examples' && subArgs.length >= 2) {
    const lang = subArgs[1];
    if (subArgs.length === 2) {
      const path = `examples/${lang}/index.md`;
      const resolved = tryResolveLlmPath(path);
      if (resolved) {
        return { kind: 'ok', content: loadLlmDoc(path), path };
      }
      return {
        kind: 'error',
        message: `regent llm: no examples for language "${lang}"`,
      };
    }
    if (subArgs.length === 3) {
      const rule = subArgs[2];
      const path = `examples/${lang}/${rule}.md`;
      const resolved = tryResolveLlmPath(path);
      if (resolved) {
        return { kind: 'ok', content: loadLlmDoc(path), path };
      }
      return {
        kind: 'error',
        message: `regent llm: no example "${rule}" for language "${lang}"`,
      };
    }
  }

  return {
    kind: 'error',
    message: `regent llm: unknown subcommand "${joined}". Try: regent llm (no args) for the index.`,
  };
}
