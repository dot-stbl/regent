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
      extends: [],
      disable: [],
      override: {},
      accept: [],
    },
    excludePaths: [],
    excludeGroups: {},
    cache: { enabled: true, maxBytes: 100 * 1024 * 1024 },
    log: { level: 'info', format: 'text' },
    output: { color: true, contextBuffer: 3 },
  };
}
