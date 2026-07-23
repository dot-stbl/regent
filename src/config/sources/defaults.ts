// Defaults — base layer for the merge pipeline.
//
// Starts as a function so callers (tests) can mint a fresh copy if
// they want to mutate without affecting others. Default shape matches
// the Zod schema's `.default()` values.

import type { RegentConfig } from '../schema.js';

export function defaultConfig(): RegentConfig {
  return {
    rules: {
      detect: [],
      fix: [],
      ast: [],
      transform: [],
      extends: [],
      disable: [],
      override: {},
      configure: {},
      accept: [],
    },
    excludePaths: [],
    excludeGroups: {},
    cache: {
      enabled: true,
      maxBytes: 100 * 1024 * 1024,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
    log: { level: 'info', format: 'text' },
    output: { color: true, contextBuffer: 3 },
    runner: { concurrency: 4 },
    // Empty scopes map: a single-project repo needs no `scopes` block.
    // `regent check` treats no-scopes as one implicit `default` scope
    // rooted at cwd (see issue #35).
    scopes: {},
    // globalRulesPath intentionally absent — undefined means
    // "no override; use the legacy default in the loader".
  };
}
