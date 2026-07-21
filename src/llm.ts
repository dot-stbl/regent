// Multi-page LLM skill documentation.
//
// `regent llm` (no args)            -> index.md (navigation hub)
// `regent llm authoring`           -> authoring/index.md (table of contents)
// `regent llm authoring detect`    -> authoring/detect.md
// `regent llm authoring fix`       -> authoring/fix.md
// `regent llm schema`              -> schema/index.md
// `regent llm schema detect`       -> schema/detect.md
// `regent llm schema fix`          -> schema/fix.md
// `regent llm examples`            -> examples/index.md (curated list)
// `regent llm examples <lang>`     -> examples/<lang>/index.md
// `regent llm examples <lang>.<rule>` -> examples/<lang>/<rule>.md
//
// Files are stored on disk at `assets/llm/`. Resolution is robust to
// the package being consumed from either the dev tree (src/...) or
// the published dist layout.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const CANDIDATE_ROOTS: readonly string[] = [
  join(HERE, '..', 'assets', 'llm'),     // src/llm.ts (dev) / dist/llm.js (built)
  join(HERE, 'assets', 'llm'),          // dist/llm.js when assets is alongside
  join(HERE, '..', '..', 'assets', 'llm'), // double-.. for nested layouts
];

function findLlmRoot(): string {
  for (const c of CANDIDATE_ROOTS) {
    if (existsSync(c)) {
      return c;
    }
  }
  throw new Error(
    `regent: assets/llm/ not found. Tried: ${CANDIDATE_ROOTS.join(', ')}`,
  );
}

/**
 * Read a single markdown file from assets/llm/. Throws when the
 * file does not exist (so callers can produce a friendly error).
 */
export function loadLlmDoc(relativePath: string): string {
  const root = findLlmRoot();
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    throw new Error(`regent llm: no doc at ${relativePath}`);
  }
  return readFileSync(path, 'utf8');
}

/**
 * @deprecated Kept for backward compatibility with the v0.1
 * `regent llm` subcommand. New code should call `loadLlmDoc('index.md')`
 * or use the multi-page router in `src/llm-router.ts`.
 */
export function loadLlmText(): string {
  return loadLlmDoc('index.md');
}

/**
 * Resolve a sub-path under the assets/llm/ tree. Returns the
 * absolute path when the file exists, null otherwise.
 */
export function tryResolveLlmPath(relativePath: string): string | null {
  try {
    const root = findLlmRoot();
    const path = join(root, relativePath);
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * Read a JSON file from `assets/llm/`. Used by `regent llm schema fix`
 * to fetch the v1 output-schema artifact (`fix-v1.json`). Throws
 * when the file is missing or the contents don't parse as JSON.
 *
 * The parse-and-stringify round-trip is intentional — the CLI emits
 * the document on stdout and any extra whitespace or trailing-comma
 * noise would break downstream parsers (issue #62).
 */
export function loadLlmJson(relativePath: string): Record<string, unknown> {
  const root = findLlmRoot();
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    throw new Error(`regent llm: no schema at ${relativePath}`);
  }
  const text = readFileSync(path, 'utf8');
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`regent llm: ${relativePath} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
