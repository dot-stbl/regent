/**
 * CLI shutdown helper. Lives in the CLI subcommand layer because the
 * 100 ms pino-worker settle window + `process.exit()` are a CLI-only
 * concern — library consumers don't need this. See #79.
 */

import { flushLogger } from '../logging/index.js';

/**
 * Flush the active logger, then exit with the given code. Use this
 * instead of `process.exit(code)` in CLI action handlers to avoid
 * the Windows shutdown crash.
 */
export async function flushAndExit(code: number): Promise<never> {
  await flushLogger();
  process.exit(code);
}
