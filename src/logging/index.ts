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
    return pino(baseOptions, destination);
  }

  return pino(
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
}

/**
 * Convenience: create a child logger scoped to a subsystem.
 */
export function scopedLogger(parent: Logger, scope: string): Logger {
  return parent.child({ scope });
}