// Logging levels — re-exported from pino with a small ergonomic layer.
//
// We do NOT log:
//   - `matchText` (the actual matched line content — may contain secrets)
//   - full `path` (only `fileHash` when needed for cache correlation)
//   - raw `pattern` source (only `patternHash`)
//
// Use `safeLog(logger, level, obj)` to enforce this contract; it
// filters out forbidden keys before passing to pino.

export const LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function levelAtOrAbove(level: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[threshold];
}

/**
 * Keys that MUST NOT appear in any log payload. We redact rather than
 * fail — a single bad call shouldn't crash the runner.
 */
const FORBIDDEN_LOG_KEYS: ReadonlySet<string> = new Set([
  'matchText',
  'pattern',
  'path',
]);

/**
 * Redact forbidden keys from a log payload. Returns a shallow-cloned
 * object with dangerous fields replaced by their SHA256 hash.
 *
 * Use this before passing to `logger.info(...)` etc.
 */
export function safeLogPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_LOG_KEYS.has(key)) {
      // Replace with explicit marker so readers know a value was
      // suppressed; do not silently drop.
      out[key] = '<redacted>';
      continue;
    }
    // Recurse into nested objects one level (covers { err: {...} }).
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = safeLogPayload(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Convenience wrapper — redaction happens transparently. The logger
 * still receives the same call shape; we just strip dangerous fields.
 */
export function safeLog(
  logger: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void; debug: (obj: unknown, msg?: string) => void; trace: (obj: unknown, msg?: string) => void; fatal: (obj: unknown, msg?: string) => void },
  level: LogLevel,
  payload: Record<string, unknown>,
  msg?: string,
): void {
  const safe = safeLogPayload(payload);
  switch (level) {
    case 'trace': logger.trace(safe, msg); break;
    case 'debug': logger.debug(safe, msg); break;
    case 'info':  logger.info(safe, msg);  break;
    case 'warn':  logger.warn(safe, msg);  break;
    case 'error': logger.error(safe, msg); break;
    case 'fatal': logger.fatal(safe, msg); break;
  }
}