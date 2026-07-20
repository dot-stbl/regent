/**
 * `regent review` reporter — surfaces pending review findings in two formats:
 *
 *   - `markdown` (default) — sectioned list, each finding has a heading +
 *     path:line, the matched line, the source link, and the rule's
 *     `guidance`. Designed for an LLM agent to read with `regent review
 *     < candidates.md > triage.json` after which it writes accept/reject
 *     decisions via `regent accept` / `regent reject`.
 *
 *   - `json` — array of structured entries for programmatic consumers.
 *
 * Accepted findings are excluded by default. Pass `--include-accepted`
 * to surface the silenced audit trail (with `acceptedReason`).
 */

import { relative } from 'node:path';

import type { AcceptEntry, Finding } from '../types.js';

export type ReviewFormat = 'markdown' | 'json';

export interface ReviewReporterOptions {
  readonly cwd: string;
  readonly includeAccepted?: boolean;
}

/**
 * Render review-only findings. Filters out violations; only emits
 * pending + (optionally) accepted.
 */
export function renderReview(
  findings: readonly Finding[],
  accepts: readonly AcceptEntry[],
  options: ReviewReporterOptions,
): string {
  const includeAccepted = options.includeAccepted ?? false;
  const pending = findings.filter((f) => f.status === 'pending');
  const accepted = findings.filter((f) => f.status === 'accepted');

  if (includeAccepted) {
    return renderAudit(pending, accepted, accepts, options);
  }
  return renderPending(pending, options.cwd);
}

function renderPending(pending: readonly Finding[], cwd: string): string {
  if (pending.length === 0) {
    return '';
  }
  const lines: string[] = [];
  lines.push('# regent review candidates');
  lines.push('');
  lines.push(`${pending.length} pending review finding(s).`);
  lines.push('');
  lines.push('> Read each finding, decide accept|reject, then call');
  lines.push('> `regent accept <rule-id> <path>:<line> --reason "..."`');
  lines.push('> `regent reject <rule-id> <path>:<line>`.');
  lines.push('');

  for (const finding of pending) {
    const rel = toForwardSlash(relative(cwd, finding.path));
    lines.push(`## \`${rel}:${finding.match.startLine + 1}\``);
    lines.push('');
    lines.push(`- **Rule:** \`${finding.ruleId}\``);
    lines.push(`- **Severity:** ${finding.severity}`);
    lines.push(`- **Match:**`);
    lines.push('  ```');
    lines.push(`  ${finding.match.matchText}`);
    lines.push('  ```');
    if (finding.source) {
      lines.push(`- **Source:** \`${finding.source}\``);
    }
    if (finding.message) {
      lines.push(`- **Message:** ${finding.message}`);
    }
    if (finding.review?.guidance) {
      lines.push(`- **Guidance:** ${finding.review.guidance}`);
    }
    if (finding.review?.exitBehavior === 'unreviewed-fails') {
      lines.push(`- **ExitBehavior:** unreviewed-fails (must be accepted to clear CI)`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderAudit(
  pending: readonly Finding[],
  accepted: readonly Finding[],
  accepts: readonly AcceptEntry[],
  options: ReviewReporterOptions,
): string {
  const lines: string[] = [];
  lines.push('# regent audit (include-accepted)');
  lines.push('');
  lines.push(`${pending.length} pending · ${accepted.length} accepted`);
  lines.push('');
  if (pending.length > 0) {
    lines.push('## Pending');
    lines.push('');
    for (const finding of pending) {
      lines.push(`- \`${toForwardSlash(relative(options.cwd, finding.path))}:${finding.match.startLine + 1}\` — ${finding.ruleId}`);
    }
    lines.push('');
  }
  if (accepted.length > 0) {
    lines.push('## Accepted');
    lines.push('');
    for (const finding of accepted) {
      lines.push(`- \`${toForwardSlash(relative(options.cwd, finding.path))}:${finding.match.startLine + 1}\` — ${finding.ruleId} (${finding.acceptedReason ?? 'accepted'})`);
    }
    lines.push('');
  }
  if (accepts.length > 0) {
    lines.push('## Accept entries (configured)');
    lines.push('');
    for (const entry of accepts) {
      const target = entry.line ? `${toForwardSlash(entry.path)}:${entry.line}` : toForwardSlash(entry.path);
      lines.push(`- \`${target}\` for \`${entry.ruleId}\` (${entry.reason})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

interface ReviewJsonEntry {
  readonly path: string;
  readonly line: number;
  readonly ruleId: string;
  readonly severity: string;
  readonly match: string;
  readonly guidance?: string;
  readonly exitBehavior?: 'no-fail' | 'unreviewed-fails';
  readonly source: string;
  readonly status: 'pending' | 'accepted';
  readonly reason?: string;
}

function toForwardSlash(p: string): string {
  return p.split('\\').join('/');
}

export function renderReviewJson(
  findings: readonly Finding[],
  accepts: readonly AcceptEntry[],
  options: { cwd: string; includeAccepted?: boolean },
): string {
  const includeAccepted = options.includeAccepted ?? false;
  const entries: ReviewJsonEntry[] = [];

  for (const finding of findings) {
    if (finding.status === 'pending') {
      entries.push({
        path: toForwardSlash(relative(options.cwd, finding.path)),
        line: finding.match.startLine + 1,
        ruleId: finding.ruleId,
        severity: finding.severity,
        match: finding.match.matchText.trim(),
        ...(finding.review?.guidance !== undefined
          ? { guidance: finding.review.guidance }
          : {}),
        ...(finding.review?.exitBehavior !== undefined
          ? { exitBehavior: finding.review.exitBehavior }
          : {}),
        source: finding.source,
        status: 'pending',
      });
    } else if (includeAccepted && finding.status === 'accepted') {
      entries.push({
        path: toForwardSlash(relative(options.cwd, finding.path)),
        line: finding.match.startLine + 1,
        ruleId: finding.ruleId,
        severity: finding.severity,
        match: finding.match.matchText.trim(),
        source: finding.source,
        status: 'accepted',
        ...(finding.acceptedReason !== undefined
          ? { reason: finding.acceptedReason }
          : {}),
      });
    }
  }

  if (includeAccepted) {
    for (const entry of accepts) {
      entries.push({
        path: toForwardSlash(entry.path),
        line: entry.line ?? 0,
        ruleId: entry.ruleId,
        severity: 'accept',
        match: entry.reason,
        source: 'accept-list',
        status: 'accepted',
        reason: entry.reason,
      });
    }
  }

  return JSON.stringify({ entries, total: entries.length }, null, 2) + '\n';
}
