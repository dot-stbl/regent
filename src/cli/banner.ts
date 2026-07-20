/**
 * CLI banner — minimal text + mark + accent line for `regent`.
 *
 * Output (2 lines):
 *
 *   regent  █  by .stbl
 *   ────────────────────────────────────────
 *
 * - "regent" — bold (primary)
 * - "█" (U+2588 full block) — represents the .stbl mark inline
 * - "by" — dim (subordinate)
 * - ".stbl" — bold (primary)
 * - Accent line below — #c44569 from .stbl brand palette, 40 chars wide
 *
 * Color is gated on `shouldUseColor` so output is monochrome when piped
 * or when `NO_COLOR` is set.
 */

import pc from 'picocolors';

const ACCENT_RGB: readonly [number, number, number] = [196, 69, 105]; // #c44569
const WIDTH = 40;
const MARK = '\u2588'; // █ — single full-block character as the .stbl mark

export interface BannerOptions {
  readonly useColor: boolean;
  readonly version?: string;
}

/**
 * Render the regent banner block. Used for both `--help` (no version)
 * and `--version` (with version arg).
 */
export function renderBanner(opts: BannerOptions): string {
  const c = opts.useColor;
  const dim = c ? pc.dim : identity;
  const bold = c ? pc.bold : identity;
  const accent = c ? hexColor(ACCENT_RGB) : identity;
  const mark = c ? bold(MARK) : MARK;

  const line1 = `${bold('regent')}  ${mark}  ${dim('by')} ${bold('.stbl')}`;
  const line2 = accent('\u2500'.repeat(WIDTH));
  const lines = [line1, line2];
  if (opts.version !== undefined) {
    const versionLine = `${bold(`regent v${opts.version}`)}  ${dim('·')}  ${accent('cli for static analysis')}`;
    lines.push(versionLine);
  }
  lines.push('');
  return lines.join('\n');
}

function identity(s: string): string {
  return s;
}

function hexColor(rgb: readonly [number, number, number]): (s: string) => string {
  const [r, g, b] = rgb;
  return (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
}