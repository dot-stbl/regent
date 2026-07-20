// Multi-page router for `regent llm [subcommand] [...]`.
//
// The CLI subcommand dispatches here based on the subcommand tree.
// We surface a single, predictable error when a sub-path is missing
// so an LLM agent can read the message and follow up.

import { loadLlmDoc, tryResolveLlmPath } from './llm.js';

export type RouterResult =
  | { kind: 'ok'; content: string; path: string }
  | { kind: 'error'; message: string };

const ROUTES: ReadonlyArray<{ prefix: string; path: string; help: string }> = [
  { prefix: 'authoring detect', path: 'authoring/detect.md', help: 'authoring detect' },
  { prefix: 'authoring fix', path: 'authoring/fix.md', help: 'authoring fix' },
  { prefix: 'authoring', path: 'authoring/index.md', help: 'authoring <kind>' },
  { prefix: 'schema detect', path: 'schema/detect.md', help: 'schema detect' },
  { prefix: 'schema fix', path: 'schema/fix.md', help: 'schema fix' },
  { prefix: 'schema', path: 'schema/index.md', help: 'schema <kind>' },
  { prefix: 'examples', path: 'examples/index.md', help: 'examples <lang>[.<rule>]' },
];

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

  const joined = subArgs.join(' ');

  for (const route of ROUTES) {
    if (route.prefix === joined) {
      try {
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
