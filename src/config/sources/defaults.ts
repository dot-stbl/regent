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
  };
}
