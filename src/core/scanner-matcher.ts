// Matcher-level scan logic — shared between the TS runner and any
// future Rust-backed implementation.
//
// The Rust core (Phase 4+) would re-implement this exact algorithm
// in Rust with the same JSON-over-stdio protocol:
//
//   { filePath, content, matcher: { pattern, excludeWhen? } }
//   -> { matches: [{ line, byteStart, byteEnd, matchText }] }
//
// Keeping the algorithm isolated here means the TS impl is the
// reference; a future Rust port is a drop-in for `FileScanner`.

import { compileRegex, type RegexMatcher } from '../regex.js';

export interface CompiledMatcher {
  readonly pattern: RegexMatcher;
  readonly exclude: RegexMatcher | null;
}

export interface LineMatch {
  readonly lineIndex: number;
  readonly line: string;
  readonly byteOffsetStart: number;
  readonly byteOffsetEnd: number;
}

/**
 * Per-line scan: applies the pattern to every line, then drops
 * lines that also match the optional `exclude` matcher.
 */
export function scanFileWithMatcher(
  matcher: CompiledMatcher,
  content: string,
): LineMatch[] {
  const lines = content.split('\n');
  const offsets = computeLineOffsets(lines);
  const out: LineMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!matcher.pattern.test(line)) {
      continue;
    }
    if (matcher.exclude && matcher.exclude.test(line)) {
      continue;
    }
    out.push({
      lineIndex: i,
      line,
      byteOffsetStart: offsets[i] ?? 0,
      byteOffsetEnd: (offsets[i] ?? 0) + line.length,
    });
  }
  return out;
}

export async function compileMatcher(
  pattern: string,
  excludeWhen: string | undefined,
): Promise<CompiledMatcher> {
  return {
    pattern: await compileRegex(pattern, { multiline: true }),
    exclude: excludeWhen !== undefined
      ? await compileRegex(excludeWhen, { multiline: true })
      : null,
  };
}

function computeLineOffsets(fileLines: readonly string[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (let i = 0; i < fileLines.length; i++) {
    offsets.push(cursor);
    cursor += (fileLines[i] ?? '').length + 1;
  }
  return offsets;
}