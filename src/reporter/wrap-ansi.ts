/**
 * wrapAnsi — ANSI-aware line wrap.
 *
 * Wraps `text` so each visual row has visible width ≤ `width`. Internal
 * `\n` characters are preserved as paragraph boundaries. Existing styled
 * spans are kept consistent across wrap rows so colour survives line
 * breaks in the middle of a styled segment.
 *
 * Algorithm (no external dependency):
 *
 * 1. Walk through `text` as a sequence of segments — either a literal
 *    character or a complete ANSI escape sequence (CSI terminator `m`).
 * 2. Track the current "active" SGR (`activeSgr`); when a row ends mid-style,
 *    emit `\x1b[0m` before the newline, and re-open the active style at the
 *    start of the next row, so each visual row keeps its appearance.
 * 3. Strip escapes for measurement; wrap at the last whitespace before
 *    `width`, or hard-break if none within `width` chars.
 * 4. Tabs (`\t`) count as 1 visible char for wrapping but pass through.
 *
 * Edge cases handled:
 *
 * - `width < 1` → return `text` unchanged.
 * - Empty / whitespace-only input → unchanged.
 * - CSI sequences other than SGR (`\x1b[...`) are ignored for wrapping
 *   (rows are not split mid-escape) and not emitted in the output.
 *
 * Not handled (deliberate, MVP — note in test fixtures):
 * - Double-width CJK characters.
 * - OSC / DCS hyperlinks (`\x1b]...;...;...`).
 * - Cursor-movement escapes (we don't emit them; this is a pure formatter).
 */

const ESC = '\u001b';

/**
 * Match an ANSI SGR sequence: CSI introducer, any number of digits/`;`,
 * terminator `m`. Used to detect, ignore, and (in the visible-length
 * helper) skip styling during measurement.
 */
// eslint-disable-next-line no-control-regex
const SGR_RE = /\u001b\[[0-9;]*m/g;

/**
 * Match any ANSI CSI sequence (covers the SGR subset + others).
 * Used by the segment splitter to keep CSI sequences atomic.
 */
// eslint-disable-next-line no-control-regex
const CSI_RE = /\u001b\[[0-9;?]*[A-HJKSTfhilmnsux]/g;

/**
 * Wrap `text` so visible-width ≤ `width` on each visual row.
 * Honors embedded `\n`s; never splits inside an ANSI escape.
 *
 * @param text  - input text (may contain ANSI escapes)
 * @param width - maximum visible width per row; `< 1` disables wrapping
 * @returns text with newlines inserted at wrap points
 */
export function wrapAnsi(text: string, width: number): string {
  if (width < 1 || text.length === 0) {
    return text;
  }
  const segments = splitAtNewlinesAndCsi(text);
  const out: string[] = [];
  let row = '';
  let rowVisible = 0;
  let activeSgr = '';

  for (const seg of segments) {
    if (seg.kind === 'sgr-open') {
      activeSgr = seg.text;
      row += seg.text;
      continue;
    }
    if (seg.kind === 'sgr-reset') {
      activeSgr = '';
      row += seg.text;
      continue;
    }
    if (seg.kind === 'newline') {
      // paragraph / wrap boundary
      if (activeSgr) {
        row += `${ESC}[0m`;
      }
      out.push(row);
      row = '';
      rowVisible = 0;
      activeSgr = ''; // styles do not cross blank rows in our reporter output
      continue;
    }
    // seg.kind === 'text'
    for (const ch of seg.text) {
      rowVisible += 1;
      row += ch;
      // Only wrap when the row strictly exceeds the budget — width is the
      // last column we allow, not the first column where we must wrap.
      if (rowVisible > width) {
        const splitAt = findLastWhitespace(row);
        if (splitAt > 0) {
          const kept = row.slice(0, splitAt);
          const rest = row.slice(splitAt).replace(/^[ \t]+/, '');
          if (rest.length > 0) {
            if (activeSgr) {
              out.push(`${kept}${ESC}[0m`);
              row = `${activeSgr}${rest}`;
            } else {
              out.push(kept);
              row = rest;
            }
          } else {
            // everything after the last whitespace was already stripped;
            // nothing meaningful carries over.
            if (activeSgr) {
              out.push(`${kept}${ESC}[0m}`);
            } else {
              out.push(kept);
            }
            row = activeSgr;
          }
          rowVisible = visibleLength(row);
        } else {
          // No whitespace inside the wrap budget — hard-break. Push the
          // first `width` chars as a row, carry the overflow chars (the
          // ones that triggered the wrap check) into the next row.
          const kept = row.slice(0, width);
          const rest = row.slice(width);
          if (activeSgr) {
            out.push(`${kept}${ESC}[0m}`);
          } else {
            out.push(kept);
          }
          row = activeSgr + rest;
          rowVisible = rest.length;
        }
      }
    }
  }

  if (row.length > 0) {
    if (activeSgr) {
      out.push(`${row}${ESC}[0m`);
    } else {
      out.push(row);
    }
  }
  return out.join('\n');
}

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'sgr-open'; text: string }
  | { kind: 'sgr-reset'; text: string }
  | { kind: 'newline'; text: string };

/**
 * Split `input` into: text runs, SGR escape sequences, and newlines.
 * SGR-open / SGR-reset are distinguished by content — a sequence
 * `\x1b[0m`, `\x1b[39m`, or `\x1b[49m` is a "reset"; everything else
 * ending in `m` is an "open".
 *
 * CSI sequences (cursor moves etc.) are dropped: we are not a terminal,
 * and the reporter doesn't emit them. If the caller passes any, they're
 * silently discarded so we don't split rows inside one.
 */
function splitAtNewlinesAndCsi(input: string): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const csiMatch = findCsiFrom(input, cursor);
    const nlIdx = input.indexOf('\n', cursor);
    if (csiMatch === null && nlIdx === -1) {
      pushText(out, input.slice(cursor));
      break;
    }
    let nextBoundary: number;
    let nextKind: 'csi' | 'newline';
    if (csiMatch === null) {
      nextBoundary = nlIdx;
      nextKind = 'newline';
    } else if (nlIdx === -1 || csiMatch.start < nlIdx) {
      nextBoundary = csiMatch.start;
      nextKind = 'csi';
    } else {
      nextBoundary = nlIdx;
      nextKind = 'newline';
    }
    if (nextBoundary > cursor) {
      pushText(out, input.slice(cursor, nextBoundary));
    }
    if (nextKind === 'newline') {
      out.push({ kind: 'newline', text: '\n' });
      cursor = nextBoundary + 1;
    } else {
      const seq = input.slice(nextBoundary, csiMatch!.end);
      if (csiMatch!.terminator === 'm') {
        if (seq === `${ESC}[0m` || seq === `${ESC}[39m` || seq === `${ESC}[49m`) {
          out.push({ kind: 'sgr-reset', text: seq });
        } else {
          out.push({ kind: 'sgr-open', text: seq });
        }
      }
      // Non-m terminators (cursor moves etc.) are dropped.
      cursor = csiMatch!.end;
    }
  }
  return out;
}

interface CsiMatch {
  start: number;
  end: number;
  terminator: string;
}

function findCsiFrom(input: string, from: number): CsiMatch | null {
  CSI_RE.lastIndex = from;
  const m = CSI_RE.exec(input);
  if (!m) {
    return null;
  }
  return {
    start: m.index,
    end: m.index + m[0].length,
    terminator: m[0].slice(-1),
  };
}

function pushText(out: Segment[], text: string): void {
  if (text.length === 0) {
    return;
  }
  out.push({ kind: 'text', text });
}

/** Position of the last whitespace char in `s`, or -1 if none. */
function findLastWhitespace(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ' ' || s[i] === '\t') {
      return i;
    }
  }
  return -1;
}

/** Visible length of `s` ignoring ANSI SGR escapes. */
function visibleLength(s: string): number {
  SGR_RE.lastIndex = 0;
  return s.replace(SGR_RE, '').length;
}
