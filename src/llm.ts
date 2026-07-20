/**
 * LLM-friendly skill documentation loader.
 *
 * Loads `assets/llm.txt` from disk relative to this module. Works in both
 * dev (`src/llm.ts` → `../assets/llm.txt`) and built (`dist/llm.js` →
 * `../assets/llm.txt` since `assets` is at the package root).
 *
 * The `--llm` flag and `regent llm` subcommand expose this to LLM agents
 * via `bunx @dot-stbl/regent --llm` for self-discovery.
 */

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const CANDIDATE_PATHS: readonly string[] = [
  join(HERE, '..', 'assets', 'llm.txt'),       // src/llm.ts (dev) / dist/llm.js (built)
  join(HERE, 'assets', 'llm.txt'),            // dist/llm.js when assets is alongside
  join(HERE, '..', '..', 'assets', 'llm.txt'), // double-.. for nested layouts
];

/**
 * Load the LLM-friendly skill documentation (llm.txt).
 *
 * Throws if the file is not found in any of the candidate paths.
 */
export function loadLlmText(): string {
  for (const candidate of CANDIDATE_PATHS) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }
  throw new Error(
    `regent: llm.txt not found. Tried: ${CANDIDATE_PATHS.join(', ')}`,
  );
}