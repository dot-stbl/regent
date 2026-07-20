// Args source — translates commander options into a partial config
// overlay. Highest precedence in the merge pipeline.
//
// CLI flags currently mapped:
//   --log-level <level>      → log.level
//   --log-format <fmt>       → log.format
//   --no-color               → output.color = false
//   --no-cache               → cache.enabled = false
//   --context-buffer <n>     → output.contextBuffer
//
// `--no-*` flags are produced by commander as `opts[key] = false` on
// the option object. We handle them as the inverse of their positive
// counterpart.

import { safeParseConfig } from '../schema.js';
import type { RegentConfig } from '../schema.js';

export interface CliArgs {
  readonly logLevel?: string;
  readonly logFormat?: string;
  readonly color?: boolean;
  readonly cache?: boolean;
  readonly contextBuffer?: number;
}

/**
 * Translate commander-resolved options into a partial config overlay.
 * Returns `null` when no recognised options are set.
 */
export function buildArgsConfig(args: CliArgs): RegentConfig | null {
  const log: { level?: RegentConfig['log']['level']; format?: RegentConfig['log']['format'] } = {};
  if (args.logLevel !== undefined) {
    log.level = args.logLevel as RegentConfig['log']['level'];
  }
  if (args.logFormat !== undefined) {
    log.format = args.logFormat as RegentConfig['log']['format'];
  }

  const cache: { enabled?: boolean } = {};
  if (args.cache !== undefined) {
    cache.enabled = args.cache;
  }

  const output: { color?: boolean; contextBuffer?: number } = {};
  if (args.color !== undefined) {
    output.color = args.color;
  }
  if (args.contextBuffer !== undefined) {
    output.contextBuffer = args.contextBuffer;
  }

  const hasAny =
    Object.keys(cache).length > 0 ||
    Object.keys(log).length > 0 ||
    Object.keys(output).length > 0;
  if (!hasAny) {
    return null;
  }

  const candidate = {
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
    cache,
    log,
    output,
  };
  const parsed = safeParseConfig(candidate);
  if (!parsed.ok) {
    throw new Error(`cli args config validation failed: ${parsed.error}`);
  }
  return parsed.value;
}