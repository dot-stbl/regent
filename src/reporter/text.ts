/**
 * Text reporter — multi-line, color-coded, picocolors-aware output.
 *
 * Each finding renders as:
 *
 *     <relative path>:<line> [<severity>] <rule-id>
 *        <line_num> │ <line content>          ← dim gutter for non-match lines
 *        <line_num> │ <line content>          ← severity-coloured gutter for match lines
 *        <line_num> │ <line content>
 *
 *       <message>
 *       Source: <back-link to .md prose>
 *
 * Review-mode findings render in their own section with a `review` tag
 * and a guidance block at the end. They never fail CI on their own
 * (the CLI handles `--exit-on` via status + rule review.exitBehavior).
 *
 * Output is line-buffered. Buffering allows inserting blank lines
 * between findings and group separators between files.
 */

import { relative } from 'node:path';
import pc from 'picocolors';

import type { Finding, Severity } from '../types.js';

interface RenderTextOptions {
  readonly cwd: string;
  readonly useColor: boolean;
  /** When true, suppress the review-mode findings section. Default: false. */
  readonly hideReview?: boolean;
}

/**
 * Render findings to a UTF-8 string. `cwd` is used to derive a
 * path-relative-from-cwd display (avoids long absolute paths).
 *
 * Pass `useColor = false` to suppress ANSI codes (e.g. when piping to a
 * file). The CLI additionally respects `NO_COLOR` env and `--no-color`.
 */
export function renderText(
  findings: readonly Finding[],
  options: RenderTextOptions,
): string {
  const c = options.useColor ? pc : createDulledColorPalette();
  const hideReview = options.hideReview ?? false;

  const violations: Finding[] = [];
  const reviews: Finding[] = [];
  for (const f of findings) {
    if (f.status === 'pending') {
      reviews.push(f);
    } else {
      violations.push(f);
    }
  }

  const lines: string[] = [];

  if (violations.length === 0 && (hideReview || reviews.length === 0)) {
    return `${c.green('✓')} no findings\n`;
  }

  if (violations.length > 0) {
    lines.push('');
    lines.push(renderSectionTitle('Violations', c));
    lines.push('');
    for (const [file, fileFindings] of groupByFile(violations)) {
      const rel = toForwardSlash(relative(options.cwd, file));
      lines.push('');
      for (const finding of fileFindings) {
        lines.push(formatFinding(finding, rel, 'violation', c));
      }
    }
  }

  if (!hideReview && reviews.length > 0) {
    lines.push('');
    lines.push(renderSectionTitle('Review candidates', c));
    lines.push('');
    for (const [file, fileFindings] of groupByFile(reviews)) {
      const rel = toForwardSlash(relative(options.cwd, file));
      lines.push('');
      for (const finding of fileFindings) {
        lines.push(formatFinding(finding, rel, 'review', c));
      }
    }
  }

  return lines.join('\n').replace(/^\n+/, '') + '\n';
}

/**
 * Render a single finding as a standalone block (header + context + message),
 * for streaming / live output. Same styling as the grouped `renderText`.
 */
export function renderFinding(finding: Finding, options: RenderTextOptions): string {
  const c = options.useColor ? pc : createDulledColorPalette();
  const rel = toForwardSlash(relative(options.cwd, finding.path));
  const stage = finding.status === 'pending' ? 'review' : 'violation';
  return `${formatFinding(finding, rel, stage, c)}\n`;
}

function renderSectionTitle(label: string, c: typeof pc): string {
  const bar = '─'.repeat(label.length + 4);
  return `${c.dim(bar)}\n  ${c.bold(label)}\n${c.dim(bar)}`;
}

function formatFinding(
  finding: Finding,
  displayPath: string,
  stage: 'violation' | 'review',
  c: typeof pc,
): string {
  const tag = stage === 'review'
    ? c.bgCyan(c.black(' review '))
    : severityTag(finding.severity, c);

  const header = `${c.bold(displayPath)}:${finding.match.startLine + 1} ${tag} ${c.cyan(finding.ruleId)}`;
  const lines: string[] = [header];

  const { startLine, endLine, lines: contextLines } = finding.context;
  const gutterWidth = String(endLine + 1).length;

  for (let i = 0; i < contextLines.length; i++) {
    const fileLineNumber = startLine + i + 1;
    const content = contextLines[i] ?? '';
    const isMatchLine =
      fileLineNumber - 1 >= finding.match.startLine
      && fileLineNumber - 1 <= finding.match.endLine;

    const gutter = isMatchLine
      ? stage === 'review'
        ? c.bgMagenta(c.bold(`${String(fileLineNumber).padStart(gutterWidth)} │ `))
        : c.bgRed(c.bold(severityBgText(finding.severity, `${String(fileLineNumber).padStart(gutterWidth)} │ `)))
      : c.gray(`${c.dim(String(fileLineNumber).padStart(gutterWidth))} ${c.dim('│ ')}`);

    lines.push(`  ${gutter}${content}`);
  }

  lines.push(`  ${c.dim('└─')} ${finding.message}`);
  if (finding.source) {
    lines.push(`  ${c.dim('Source:')} ${c.dim(finding.source)}`);
  }
  if (stage === 'review' && finding.review?.guidance) {
    lines.push(`  ${c.dim('Guidance:')} ${finding.review.guidance}`);
    if (finding.review.exitBehavior === 'unreviewed-fails') {
      lines.push(`  ${c.dim('(')}exitBehavior: unreviewed-fails${c.dim(')')}`);
    }
  }
  if (finding.acceptedReason) {
    lines.push(`  ${c.dim('Accepted:')} ${finding.acceptedReason}`);
  }
  return lines.join('\n');
}

function severityTag(s: Severity, c: typeof pc): string {
  switch (s) {
    case 'error':
      return c.bgRed(c.black(' error '));
    case 'warning':
      return c.bgYellow(c.black(' warning '));
    case 'suggestion':
      return c.bgCyan(c.black(' suggestion '));
  }
}

function severityBgText(s: Severity, text: string): string {
  if (s === 'error') {
    return text;
  }
  if (s === 'warning') {
    return pc.yellow(text);
  }
  return pc.cyan(text);
}

function groupByFile(findings: readonly Finding[]): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!out.has(f.path)) {
      out.set(f.path, []);
    }
    out.get(f.path)!.push(f);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.match.startLine - b.match.startLine);
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function toForwardSlash(p: string): string {
  return p.split('\\').join('/');
}

function createDulledColorPalette(): typeof pc {
  return {
    ...pc,
    red: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
    magenta: (s: string) => s,
    gray: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
    bgRed: (s: string) => s,
    bgYellow: (s: string) => s,
    bgCyan: (s: string) => s,
    bgMagenta: (s: string) => s,
    black: (s: string) => s,
    green: (s: string) => s,
  } as unknown as typeof pc;
}

export function renderSummary(
  findings: readonly Finding[],
  rules: readonly { spec: { id: string; severity: string } }[],
  useColor: boolean,
): string {
  const c = useColor ? pc : createDulledColorPalette();
  const counts = { error: 0, warning: 0, suggestion: 0, pending: 0, accepted: 0, violation: 0 };
  for (const f of findings) {
    counts[f.severity]++;
    if (f.status === 'pending') counts.pending++;
    if (f.status === 'accepted') counts.accepted++;
    if (f.status === 'violation') counts.violation++;
  }
  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(`${c.red(`${counts.error} error${counts.error === 1 ? '' : 's'}`)}`);
  }
  if (counts.warning > 0) {
    parts.push(`${c.yellow(`${counts.warning} warning${counts.warning === 1 ? '' : 's'}`)}`);
  }
  if (counts.suggestion > 0) {
    parts.push(`${c.cyan(`${counts.suggestion} suggestion${counts.suggestion === 1 ? '' : 's'}`)}`);
  }
  if (counts.violation > 0) {
    parts.push(`${c.dim(`${counts.violation} violation${counts.violation === 1 ? '' : 's'}`)}`);
  }
  if (counts.pending > 0) {
    parts.push(`${c.cyan(`${counts.pending} review`)}`);
  }
  if (counts.accepted > 0) {
    parts.push(`${c.dim(`${counts.accepted} accepted`)}`);
  }
  return `${rules.length} rules · ${parts.join(' · ')}\n`;
}

export interface TextReporterOptions {
  readonly cwd: string;
  readonly useColor: boolean;
  readonly contextBuffer: number;
  readonly hideReview?: boolean;
}
