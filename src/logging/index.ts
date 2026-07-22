// Logger factory. Wraps pino with project-level ergonomics:
//   - `text` format: pino-pretty (TTY-friendly, colour)
//   - `json` format: raw JSON (CI / log aggregators)
//
// `createLogger()` is the only public entry. Children are obtained
// via `logger.child({ module: 'runner' })` — pino supports nested
// contexts natively.

import pino, { type Logger as PinoLogger } from 'pino';

import type { LogLevel } from './levels.js';

export type Logger = PinoLogger;

export interface CreateLoggerOptions {
  readonly level: LogLevel;
  readonly format: 'text' | 'json';
  readonly scope?: string;
}

/**
 * The active logger's underlying stream. Tracked so that
 * `flushAndExit()` / `flushLogger()` can call `.end()` on it before
 * the process exits, otherwise the pino-pretty worker thread can be
 * left in CLOSING state on Windows and trigger a libuv
 * `UV_HANDLE_CLOSING` assertion during shutdown. See #79.
 */
let activeStream: { end?: () => void; destroy?: (cb?: (err?: Error) => void) => void } | null = null;

const FLUSH_SETTLE_MS = 100;
const FLUSH_TIMEOUT_MS = 500;

/**
 * Build a logger with the given level + output format.
 *
 * All logs go to **stderr** (findings/reports stay on stdout). In
 * `text` mode we route through pino-pretty when stderr is a TTY;
 * otherwise we still emit text but without ANSI codes (so logs piped
 * to a file remain readable). In `json` mode we emit raw NDJSON.
 *
 * `scope` is applied as a child binding — every line carries a
 * `scope` field identifying the originating subsystem.
 */
export function createLogger(opts: CreateLoggerOptions): Logger {
  const isTTY = process.stderr.isTTY === true;

  const baseOptions: pino.LoggerOptions = {
    level: opts.level,
    base: opts.scope !== undefined ? { scope: opts.scope } : undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['*.matchText', '*.pattern', '*.path', 'matchText', 'pattern', 'path'],
      remove: false,
    },
  };

  // Force logs to stderr via fd 2 — pino defaults to stdout which
  // would mix with reporter output.
  const destination = pino.destination({ dest: 2, sync: true });

  if (opts.format === 'json') {
    activeStream = destination;
    return pino(baseOptions, destination);
  }

  const logger = pino(
    {
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: isTTY,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,scope',
          singleLine: false,
          destination: 2,
        },
      },
    },
    destination,
  );
  // For `pino(options, destination)` the *outer* target is the
  // destination we passed in; the transport (`pino-pretty`) is the
  // inner worker stream. Pino's transport endpoint is reachable via
  // the `pino.stream` symbol on the logger — but reading the
  // user-supplied destination is enough for `.end()` here because
  // we just need to flush the writer chain.
  activeStream = destination;
  return logger;
}

/**
 * Convenience: create a child logger scoped to a subsystem.
 */
export function scopedLogger(parent: Logger, scope: string): Logger {
  return parent.child({ scope });
}

/**
 * Flush the active logger's underlying stream and wait briefly for
 * the worker thread to drain. This is the workaround for the libuv
 * `UV_HANDLE_CLOSING` assertion that fires on Windows when
 * `process.exit()` is called while the pino-pretty worker thread is
 * still in CLOSING state (#79).
 *
 * Safe to call repeatedly; safe to call when no logger is active.
 */
export async function flushLogger(): Promise<void> {
  if (activeStream) {
    try {
      activeStream.end?.();
    } catch {
      // best-effort — the stream may already be closed
    }
  }
  // Give the worker thread a chance to handle the end sentinel and
  // close its stdio handles. The settle window is short on purpose:
  // most CLI invocations are < 100ms and we don't want to add
  // visible latency. The timeout is a safety net so we never hang
  // forever in shutdown.
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    setTimeout(finish, FLUSH_SETTLE_MS);
    setTimeout(finish, FLUSH_TIMEOUT_MS);
  });
}

/**
 * Flush the active logger, then exit with the given code. Use this
 * instead of `process.exit(code)` in CLI action handlers to avoid
 * the Windows shutdown crash (#79).
 */
export async function flushAndExit(code: number): Promise<never> {
  await flushLogger();
  process.exit(code);
}