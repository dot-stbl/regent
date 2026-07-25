/**
 * HTML reporter for `regent check --format html`.
 *
 * Produces a single self-contained `.html` file suitable for emailing to
 * non-CLI users (PM, security) or archiving a snapshot of a regent run.
 *
 * Constraints (intentional):
 *   - NO external assets (no CDN, no web fonts, no <script>).
 *   - NO JavaScript — pure static markup; the file is safe to host
 *     behind `Content-Security-Policy: default-src 'none'`.
 *   - Light + dark theme via `prefers-color-scheme` (one CSS block,
 *     no toggle). Print-friendly.
 *   - Always under ~5 MB even for huge reports — context snippets are
 *     capped at 3 lines per finding; long messages are not truncated
 *     (HTML can absorb them), but we do not embed full file contents.
 *
 * The output mirrors the text reporter's data model:
 *   - header: project name, generation timestamp, scan stats, severity
 *     counts
 *   - one row per finding: location / severity / rule-id / message
 *   - one nested row with a 3-line code excerpt (monospace + tinted
 *     background, match line emphasized)
 *   - footer: regent version + source hint
 *
 * Path normalisation: forward-slash + repo-relative (mirrors the SARIF
 * and JSON reporters — see `src/reporter/json.ts` for the rationale).
 *
 * Defensive shapes:
 *   - Synthetic findings without a real `(path, startLine)` skip the
 *     location cell rather than crash.
 *   - Findings without a context window render without the code-excerpt
 *     row.
 *   - Long messages / source links are HTML-escaped — never inlined raw.
 */
import { relative } from 'node:path';

import type { Finding, RunResult } from '../types.js';

export interface HtmlReporterOptions {
  readonly cwd: string;
  /** Display name for the project (default: basename(cwd)). */
  readonly projectName?: string;
  /** Override the "files scanned" line (default: run.scannedFiles). */
  readonly scannedFiles?: number;
  /** RegEnt package version (default: 'dev'). Used in the footer. */
  readonly version?: string;
}

interface SeverityCounts {
  error: number;
  warning: number;
  suggestion: number;
  violation: number;
  pending: number;
  accepted: number;
}

const ZERO_COUNTS: SeverityCounts = {
  error: 0,
  warning: 0,
  suggestion: 0,
  violation: 0,
  pending: 0,
  accepted: 0,
};

/**
 * Render the run result as a self-contained HTML document.
 *
 * Returns the document as a string. Callers may write it to a file
 * (recommended — HTML is bulky on a terminal) via `fs.writeFileSync`,
 * or to stdout when piping to a browser or pager.
 */
export function renderHtml(
  run: RunResult,
  options: HtmlReporterOptions,
): string {
  const project = options.projectName ?? basenameOf(options.cwd);
  const scanned = options.scannedFiles ?? run.scannedFiles;
  const version = options.version ?? 'dev';
  const generatedAt = new Date().toISOString();
  const counts = countBySeverity(run.findings);
  const sorted = sortFindings(run.findings, options.cwd);

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>regent check — ${escapeHtml(project)}</title>`,
    '<style>',
    CSS,
    '</style>',
    '</head>',
    '<body>',
    renderHeader(project, generatedAt, scanned, counts, run.findings.length),
    '<main>',
    '<h2>Findings <span class="count">',
    `${run.findings.length}</span></h2>`,
    renderFindingsTable(sorted, options.cwd),
    '</main>',
    renderFooter(version),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/* ---------- header / footer ---------- */

function renderHeader(
  project: string,
  generatedAt: string,
  scannedFiles: number,
  counts: SeverityCounts,
  totalFindings: number,
): string {
  return [
    '<header>',
    '<h1>regent check report</h1>',
    '<dl class="meta">',
    `<dt>Project</dt><dd>${escapeHtml(project)}</dd>`,
    `<dt>Generated</dt><dd><time datetime="${escapeHtml(generatedAt)}">`,
    `${escapeHtml(formatTimestamp(generatedAt))}</time></dd>`,
    `<dt>Files scanned</dt><dd>${scannedFiles.toLocaleString('en-US')}</dd>`,
    `<dt>Total findings</dt><dd>${totalFindings.toLocaleString('en-US')}</dd>`,
    '</dl>',
    renderCounters(counts),
    '</header>',
  ].join('\n');
}

function renderCounters(counts: SeverityCounts): string {
  const chips: string[] = [];
  if (counts.error > 0) {
    chips.push(
      `<span class="chip chip-error">${counts.error} error${plural(counts.error)}</span>`,
    );
  }
  if (counts.warning > 0) {
    chips.push(
      `<span class="chip chip-warning">${counts.warning} warning${plural(counts.warning)}</span>`,
    );
  }
  if (counts.suggestion > 0) {
    chips.push(
      `<span class="chip chip-suggestion">${counts.suggestion} suggestion${plural(counts.suggestion)}</span>`,
    );
  }
  if (counts.violation > 0) {
    chips.push(
      `<span class="chip chip-muted">${counts.violation} violation${plural(counts.violation)}</span>`,
    );
  }
  if (counts.pending > 0) {
    chips.push(
      `<span class="chip chip-review">${counts.pending} review</span>`,
    );
  }
  if (counts.accepted > 0) {
    chips.push(
      `<span class="chip chip-muted">${counts.accepted} accepted</span>`,
    );
  }
  if (chips.length === 0) {
    return '<p class="all-clear">✓ no findings</p>';
  }
  return `<p class="counters">${chips.join(' ')}</p>`;
}

function renderFooter(version: string): string {
  return [
    '<footer>',
    `<p>Generated by <a class="ext" href="https://github.com/dot-stbl/regent">@dot-stbl/regent</a> v${escapeHtml(version)}</p>`,
    '<p class="hint">Self-contained snapshot — no external assets, no scripts. Safe to share.</p>',
    '</footer>',
  ].join('\n');
}

/* ---------- findings table ---------- */

function renderFindingsTable(
  findings: readonly Finding[],
  cwd: string,
): string {
  if (findings.length === 0) {
    return '<table class="findings"><tbody>'
      + '<tr class="empty"><td>No findings.</td></tr>'
      + '</tbody></table>';
  }
  const rows: string[] = [];
  rows.push(
    '<table class="findings">',
    '<thead>',
    '<tr>',
    '<th scope="col">Location</th>',
    '<th scope="col">Severity</th>',
    '<th scope="col">Rule</th>',
    '<th scope="col">Message</th>',
    '</tr>',
    '</thead>',
    '<tbody>',
  );
  for (const finding of findings) {
    rows.push(...renderFindingRows(finding, cwd));
  }
  rows.push('</tbody>', '</table>');
  return rows.join('\n');
}

function renderFindingRows(finding: Finding, cwd: string): string[] {
  const location = formatLocation(finding, cwd);
  const ruleId = escapeHtml(finding.ruleId);
  const message = escapeHtml(finding.message);
  // Defensive: a finding without a `status` (e.g. a synthetic test
  // fixture) renders as if it were a violation. Same default the
  // text reporter uses for non-review rules.
  const status: 'violation' | 'pending' | 'accepted' = finding.status ?? 'violation';
  const dataAttrs = [
    `data-severity="${escapeHtml(finding.severity)}"`,
    `data-status="${escapeHtml(status)}"`,
  ];

  const sevLabel = status === 'pending' && finding.review
    ? 'review'
    : finding.severity;
  const sevClass = `sev sev-${escapeHtml(sevLabel)}`;

  const rows: string[] = [
    `<tr class="finding" ${dataAttrs.join(' ')}>`,
    `<td class="loc">${location || '<span class="synthetic">synthetic</span>'}</td>`,
    `<td><span class="${sevClass}">${escapeHtml(sevLabel)}</span></td>`,
    `<td><code class="rule">${ruleId}</code></td>`,
    `<td class="message">${message}</td>`,
    '</tr>',
  ];

  if (hasContext(finding)) {
    rows.push(renderContextRow(finding));
  }

  return rows;
}

function renderContextRow(finding: Finding): string {
  const { startLine, lines } = finding.context;
  const isPending = finding.status === 'pending';
  const pre: string[] = ['<tr class="excerpt">', '<td colspan="4">', '<pre class="code"><code>'];

  const gutterWidth = String(startLine + lines.length).length;
  for (let i = 0; i < lines.length; i++) {
    const fileLine = startLine + i + 1; // 1-indexed display
    const content = lines[i] ?? '';
    const isMatch = isPending
      ? false
      : fileLine - 1 >= finding.match.startLine
        && fileLine - 1 <= finding.match.endLine;
    const lineClass = isMatch ? 'match' : 'dim';
    const gutter = String(fileLine).padStart(gutterWidth, ' ');
    pre.push(
      `<span class="line ${lineClass}">`
      + `<span class="gutter">${escapeHtml(gutter)}</span>`
      + `<span class="content">${escapeHtml(content) || '&nbsp;'}</span>`
      + '</span>',
    );
  }

  pre.push('</code></pre>');
  if (finding.rationale) {
    pre.push(`<p class="rationale">${escapeHtml(finding.rationale)}</p>`);
  }
  if (finding.source) {
    pre.push(
      `<p class="source">Source: <code>${escapeHtml(finding.source)}</code></p>`,
    );
  }
  pre.push('</td>', '</tr>');
  return pre.join('\n');
}

/* ---------- helpers ---------- */

function formatLocation(finding: Finding, cwd: string): string {
  // Defensive: synthetic findings may carry `path: ''` and a -1
  // startLine. The text reporter does the same check; we mirror it.
  if (!finding.path || finding.match.startLine < 0) {
    return '';
  }
  const rel = toForwardSlash(relative(cwd, finding.path));
  const line = finding.match.startLine + 1;
  const col = finding.match.startColumn + 1;
  return `<code>${escapeHtml(rel)}:${line}:${col}</code>`;
}

function hasContext(finding: Finding): boolean {
  return finding.context.lines.length > 0;
}

function countBySeverity(findings: readonly Finding[]): SeverityCounts {
  const c: SeverityCounts = { ...ZERO_COUNTS };
  for (const f of findings) {
    c[f.severity]++;
    // Defensive: a finding without `status` counts as a violation
    // (mirrors the row default above).
    c[f.status ?? 'violation']++;
  }
  return c;
}

function sortFindings(findings: readonly Finding[], cwd: string): readonly Finding[] {
  return [...findings].sort((a, b) => {
    const pa = toForwardSlash(relative(cwd, a.path));
    const pb = toForwardSlash(relative(cwd, b.path));
    if (pa !== pb) {
      return pa.localeCompare(pb);
    }
    return a.match.startLine - b.match.startLine;
  });
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]+/).filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? p;
}

function toForwardSlash(p: string): string {
  return p.split('\\').join('/');
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}

function formatTimestamp(iso: string): string {
  // Render the timestamp in the viewer's local zone (browser does the
  // conversion via `<time datetime="…">`). The displayed string is the
  // raw ISO with a friendlier shape: "2026-07-26 18:42:13 UTC".
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/**
 * Minimal HTML entity escaper. Covers the five XML predefined
 * entities + the backtick (so we never close an attribute or <code>
 * block by accident in a piece of user data).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/* ---------- stylesheet (single block, light + dark) ---------- */

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --surface: #f6f7f9;
  --surface-2: #eef0f3;
  --border: #d8dce1;
  --ink: #1a1d21;
  --ink-muted: #5a6068;
  --ink-faint: #8a9098;
  --code-bg: #f0f2f5;
  --match-bg: #fff3c4;
  --match-ink: #1a1d21;
  --link: #0b5cff;
  --sev-error: #c41e3a;
  --sev-error-soft: #fde2e7;
  --sev-warning: #a8651b;
  --sev-warning-soft: #fdebcf;
  --sev-suggestion: #1f6feb;
  --sev-suggestion-soft: #dde8fb;
  --sev-review: #6a3fa0;
  --sev-review-soft: #ecdef9;
  --sev-muted: #5a6068;
  --sev-muted-soft: #e6e8eb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15171a;
    --surface: #1c1f23;
    --surface-2: #23272c;
    --border: #2e3338;
    --ink: #e6e8eb;
    --ink-muted: #a4abb3;
    --ink-faint: #71777e;
    --code-bg: #1a1d21;
    --match-bg: #5c4a14;
    --match-ink: #fff3c4;
    --link: #6aa1ff;
    --sev-error: #ff7a8a;
    --sev-error-soft: #3a1a21;
    --sev-warning: #ffc56b;
    --sev-warning-soft: #3a2a10;
    --sev-suggestion: #82b1ff;
    --sev-suggestion-soft: #1a2740;
    --sev-review: #c69df3;
    --sev-review-soft: #28193d;
    --sev-muted: #a4abb3;
    --sev-muted-soft: #23272c;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue",
               Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  padding: 24px 32px 48px;
  max-width: 1280px;
  margin: 0 auto;
}
header { border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; }
h1 { font-size: 22px; margin: 0 0 12px; }
h2 { font-size: 16px; margin: 24px 0 12px; }
h2 .count { color: var(--ink-muted); font-weight: 400; }
dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
dl.meta dt { color: var(--ink-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
dl.meta dd { margin: 0; }
.counters { margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
.all-clear { color: var(--ink-muted); margin: 12px 0 0; }
.chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  background: var(--surface);
  border: 1px solid var(--border);
}
.chip-error    { background: var(--sev-error-soft);    color: var(--sev-error);    border-color: transparent; }
.chip-warning  { background: var(--sev-warning-soft);  color: var(--sev-warning);  border-color: transparent; }
.chip-suggestion { background: var(--sev-suggestion-soft); color: var(--sev-suggestion); border-color: transparent; }
.chip-review   { background: var(--sev-review-soft);   color: var(--sev-review);   border-color: transparent; }
.chip-muted    { color: var(--ink-muted); }
main { margin-top: 8px; }
table.findings { width: 100%; border-collapse: collapse; font-size: 13px; }
table.findings thead th {
  text-align: left;
  font-weight: 600;
  padding: 8px 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  color: var(--ink-muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
table.findings tbody tr.finding td {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
table.findings tbody tr.finding:last-child td { border-bottom: none; }
table.findings tbody tr.excerpt td { padding: 0 10px 12px 10px; border-bottom: 1px solid var(--border); }
table.findings tbody tr.empty td { padding: 20px; text-align: center; color: var(--ink-muted); }
td.loc { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; white-space: nowrap; }
td.loc code { background: transparent; padding: 0; }
code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
code.rule { color: var(--link); }
.synthetic { color: var(--ink-faint); font-style: italic; font-size: 12px; }
.scope { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--surface-2); color: var(--ink-muted); margin-left: 4px; }
.sev {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: lowercase;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.sev-error      { background: var(--sev-error-soft);      color: var(--sev-error); }
.sev-warning    { background: var(--sev-warning-soft);    color: var(--sev-warning); }
.sev-suggestion { background: var(--sev-suggestion-soft); color: var(--sev-suggestion); }
.sev-review     { background: var(--sev-review-soft);     color: var(--sev-review); }
td.message { word-break: break-word; }
pre.code {
  margin: 0;
  padding: 10px 12px;
  background: var(--code-bg);
  border-radius: 6px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.45;
}
pre.code code { white-space: pre; }
.line { display: block; }
.line.dim { color: var(--ink-faint); }
.line.match {
  background: var(--match-bg);
  color: var(--match-ink);
  margin: 0 -12px;
  padding: 0 12px;
}
.line .gutter {
  display: inline-block;
  width: 4ch;
  color: var(--ink-faint);
  text-align: right;
  padding-right: 1ch;
  user-select: none;
}
.line.match .gutter { color: var(--match-ink); font-weight: 600; }
.line .content { white-space: pre; }
p.rationale { color: var(--ink-muted); margin: 8px 0 4px; font-size: 12px; }
p.source { color: var(--ink-muted); margin: 4px 0 0; font-size: 12px; }
p.source code { color: var(--ink-faint); }
footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--ink-muted); font-size: 12px; }
footer p { margin: 4px 0; }
footer a { color: var(--link); }
footer .hint { color: var(--ink-faint); }
@media (max-width: 720px) {
  body { padding: 16px; }
  table.findings thead { display: none; }
  table.findings tbody tr.finding td {
    display: block;
    padding: 4px 10px;
  }
  table.findings tbody tr.finding td.loc { padding-top: 10px; font-size: 12px; }
  table.findings tbody tr.excerpt td { display: block; padding: 0 10px 12px; }
}
@media print {
  body { padding: 0; max-width: none; }
  pre.code { page-break-inside: avoid; }
  table.findings tbody tr.finding { page-break-inside: avoid; }
}
`.trim();
