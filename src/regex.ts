/**
 * RE2 wrapper — linear-time regex matching.
 *
 * `re2-wasm` is Google's RE2 library distributed as WASM. Its JS bindings
 * mimic JavaScript's `RegExp` interface but use RE2 syntax (no
 * backreferences, no lookahead). Linear-time matching eliminates ReDoS
 * as a surface.
 *
 * `re2-wasm` 1.0.2 exposes the RE2 class either as a named export, a
 * default export wrapping `{ RE2 }`, or directly as the default export.
 * We probe and use whichever is available.
 */

import * as re2Module from 're2-wasm';

interface Re2Like {
  test(input: string): boolean;
  match(input: string): unknown;
  exec(input: string): unknown;
  readonly source: string;
  readonly global: boolean;
}

type Re2Ctor = new (pattern: string, flags?: string) => Re2Like;

function resolveRe2Ctor(): Re2Ctor {
  const mod = re2Module as unknown as {
    RE2?: Re2Ctor;
    default?: Re2Ctor | { RE2?: Re2Ctor };
  };
  if (typeof mod.RE2 === 'function') {
    return mod.RE2;
  }
  const def = mod.default;
  if (def && typeof def === 'function') {
    return def as unknown as Re2Ctor;
  }
  if (def && typeof def === 'object' && typeof def.RE2 === 'function') {
    return def.RE2;
  }
  throw new Error('re2-wasm: cannot locate RE2 class (named, default, or wrapped-default)');
}

const Re2: Re2Ctor = resolveRe2Ctor();

/**
 * First-match result: precise byte offsets within the scanned input plus
 * capture-group values.
 *
 * Group *offsets* are intentionally absent — re2-wasm does not implement the
 * `d` flag (`.indices`), so only group values are recoverable here. That is
 * enough for `$n` template expansion; a fix engine that needs a group's span
 * derives it from these values when required.
 */
export interface MatchHit {
  /** 0-based byte offset of the match start within the input. */
  readonly start: number;
  /** 0-based byte offset one past the match end. */
  readonly end: number;
  /** The matched substring (capture group 0). */
  readonly text: string;
  /** Capture-group values (group 1..n); null for non-participating groups. */
  readonly groups: readonly (string | null)[];
}

export interface RegexMatcher {
  readonly source: string;
  /** True if `input` contains a match. */
  test(input: string): boolean;
  /**
   * First match in `input`, with precise offsets + capture-group values,
   * or null if there is no match. Uses a non-global `exec`, so it carries
   * no `lastIndex` state and is safe to call repeatedly / interleaved with
   * `test`.
   */
  firstMatch(input: string): MatchHit | null;
}

export interface MatchResult {
  /** 0-based byte offset where the match starts. */
  readonly start: number;
  /** 0-based byte offset one past the last matched character. */
  readonly end: number;
  /** Substring of the match. */
  readonly text: string;
}

/**
 * Compile a RE2 pattern. Patterns use RE2 syntax — refer to
 * https://github.com/google/re2/wiki/Syntax.
 *
 * Throws `SyntaxError` if the pattern is malformed.
 */
export function compileRegex(
  source: string,
  options: { multiline?: boolean } = {},
): RegexMatcher {
  try {
    const flags = options.multiline ? 'um' : 'u';
    const matcher = new Re2(source, flags);

    return {
      source,
      test: (input: string) => matcher.test(input),
      firstMatch: (input: string): MatchHit | null => {
        const m = matcher.exec(input) as
          | ({ index?: number; length: number } & { [k: number]: string | undefined })
          | null;
        if (!m || typeof m.index !== 'number') {
          return null;
        }
        const text = m[0] ?? '';
        const groups: (string | null)[] = [];
        for (let i = 1; i < m.length; i++) {
          const g = m[i];
          groups.push(g === undefined || g === null ? null : g);
        }
        return { start: m.index, end: m.index + text.length, text, groups };
      },
    };
  } catch (err) {
    throw new Error(`invalid RE2 pattern: ${source}: ${(err as Error).message}`);
  }
}

/**
 * Scan a buffer for the first match of a pattern. Returns offsets + match
 * text. Multi-line matches are not currently supported by the runner —
 * rules compose per-line patterns.
 */
export function scanFirst(
  source: string,
  buffer: string,
): MatchResult | undefined {
  const matcher = new Re2(source, 'u');
  const match = matcher.match(buffer) as { index?: number } | null;
  if (!match || typeof match.index !== 'number') {
    return undefined;
  }
  const text = buffer.slice(match.index);
  return { start: match.index, end: match.index + text.length, text };
}

/**
 * Locate which line `offset` (in `buffer`) falls on, plus the column.
 * Lines are split on `\n`. Trailing `\r` on `\r\n` is stripped.
 */
export function locationAt(buffer: string, offset: number): { line: number; column: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < buffer.length; i++) {
    if (buffer[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart };
}

/**
 * Extract a context window around `[startOffset, endOffset]` in `buffer`,
 * including `bufferLines` lines before start and after end.
 *
 * Line indices are 0-based. The returned `lines` are the file's lines
 * within the window; the caller can format them with line numbers.
 */
export interface ContextWindow {
  readonly startLine: number;
  readonly endLine: number;
  readonly lines: readonly string[];
}

export function extractContext(
  buffer: string,
  startOffset: number,
  endOffset: number,
  bufferLines: number,
): ContextWindow {
  const startLoc = locationAt(buffer, startOffset);
  const endLoc = locationAt(buffer, endOffset);

  const startLine = Math.max(0, startLoc.line - bufferLines);
  const totalLines = buffer.split('\n').length;
  const endLine = Math.min(totalLines - 1, endLoc.line + bufferLines);

  const lines = buffer.split('\n').slice(startLine, endLine + 1);
  return { startLine, endLine, lines };
}
