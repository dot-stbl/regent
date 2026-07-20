/**
 * SARIF 2.1 reporter.
 *
 * Output conforms to the GitHub code-scanning schema
 * (https://github.com/octokit/.github/blob/master/.github/codeql-config.yml)
 * with subset features:
 *   - `result.ruleId` + `result.level`
 *   - `result.message.text` (finding message + rationale)
 *   - `result.locations[].physicalLocation.artifactLocation.uri`
 *   - `result.locations[].physicalLocation.region` with start/end lines
 *     AND a context window via `contextRegion.snippet`
 *   - `result.properties.review = true` + `result.properties.guidance`
 *     for review-mode findings (pending|accepted); `level: 'note'`
 *
 * Each SARIF run has its own attached rule descriptor, so consumers
 * can render the full file path + rule provenance without an external
 * registry.
 */

import { relative } from 'node:path';

import type {
  CompiledRule,
  Finding,
  Severity,
} from '../types.js';

interface SarifLog {
  readonly $schema: string;
  readonly version: '2.1.0';
  readonly runs: readonly SarifRun[];
}

interface SarifRun {
  readonly tool: {
    readonly driver: {
      readonly name: '@dot-stbl/regent';
      readonly version: string;
      readonly informationUri: string;
      readonly rules: readonly SarifReportingDescriptor[];
    };
  };
  readonly results: readonly SarifResult[];
}

interface SarifReportingDescriptor {
  readonly id: string;
  readonly name: string;
  readonly shortDescription: { readonly text: string };
  readonly defaultConfiguration?: { readonly level: SarifLevel };
  readonly helpUri?: string;
  readonly properties?: { readonly review?: boolean };
}

type SarifLevel = 'error' | 'warning' | 'note';

interface SarifResult {
  readonly ruleId: string;
  readonly level: SarifLevel;
  readonly message: { readonly text: string };
  readonly locations: readonly {
    readonly physicalLocation: {
      readonly artifactLocation: { readonly uri: string };
      readonly region: SarifRegion;
      readonly contextRegion?: SarifRegion;
    };
  }[];
  readonly properties?: {
    readonly review?: boolean;
    readonly guidance?: string;
    readonly exitBehavior?: 'no-fail' | 'unreviewed-fails';
    readonly status?: 'pending' | 'accepted' | 'violation';
    readonly kind?: 'detect' | 'fix';
    readonly fixable?: boolean;
  };
}

interface SarifRegion {
  readonly startLine: number;
  readonly startColumn?: number;
  readonly endLine: number;
  readonly endColumn?: number;
  readonly snippet?: { readonly text: string };
}

export function renderSarif(
  findings: readonly Finding[],
  rules: readonly CompiledRule[],
  options: { cwd: string; includeAccepted?: boolean },
): string {
  const acceptedFindings = findings.filter((f) => f.status === 'accepted');
  const surfaced = options.includeAccepted
    ? findings
    : findings.filter((f) => f.status !== 'accepted');

  const reportingDescriptors: SarifReportingDescriptor[] = rules.map((r) => ({
    id: r.spec.id,
    name: r.spec.id.replace(/\./g, '_'),
    shortDescription: { text: r.spec.message },
    defaultConfiguration: {
      level: severityToSarifLevel(r.spec.severity),
    },
    helpUri: r.source.startsWith('http') ? r.source : undefined,
    properties: r.spec.review?.enabled ? { review: true } : undefined,
  }));

  const results: SarifResult[] = surfaced.map((f) => {
    const contextSnippet = f.context.lines.join('\n');
    // v0.2: each finding carries its kind (detect vs fix) so SARIF
    // consumers can distinguish "would change" from "would only report".
    // The kind is derived from the underlying rule spec — we read it
    // from `rules` (the input array) via the ruleId.
    const ruleSpec = rules.find((r) => r.spec.id === f.ruleId)?.spec;
    const kind: 'detect' | 'fix' | undefined =
      ruleSpec && 'find' in ruleSpec && 'replace' in ruleSpec ? 'fix' : 'detect';
    const properties: SarifResult['properties'] = f.review
      ? {
          review: true,
          status: f.status,
          ...(kind !== undefined ? { kind } : {}),
          fixable: kind === 'fix',
          ...(f.review.guidance !== undefined ? { guidance: f.review.guidance } : {}),
          exitBehavior: f.review.exitBehavior,
        }
      : {
          status: f.status,
          ...(kind !== undefined ? { kind } : {}),
          fixable: kind === 'fix',
        };

    return {
      ruleId: f.ruleId,
      level: f.review ? 'note' : severityToSarifLevel(f.severity),
      message: {
        text: buildMessageText(f),
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: toSarifUri(relative(options.cwd, f.path)),
            },
            region: {
              startLine: f.match.startLine + 1,
              startColumn: f.match.startColumn + 1,
              endLine: f.match.endLine + 1,
              endColumn: f.match.endColumn,
              snippet: { text: f.match.matchText },
            },
            contextRegion: {
              startLine: f.context.startLine + 1,
              endLine: f.context.endLine + 1,
              snippet: { text: contextSnippet },
            },
          },
        },
      ],
      properties,
    };
  });

  // Surfaced-and-accepted counts separately so consumers can audit
  // silenced findings without losing track of them.
  const log: SarifLog = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: '@dot-stbl/regent',
            version: '0.1.0',
            informationUri: 'https://github.com/dot-stbl/regent',
            rules: reportingDescriptors,
          },
        },
        results,
      },
    ],
  };

  if (acceptedFindings.length > 0) {
    void acceptedFindings;
    // Note: the spec does not have a built-in 'silenced' field; consumers
    // can re-run with --include-accepted to surface these for audit.
  }

  return JSON.stringify(log, null, 2) + '\n';
}

function buildMessageText(f: Finding): string {
  const head = `${f.message}`;
  const parts = [head];
  if (f.rationale) {
    parts.push(f.rationale);
  }
  if (f.review?.guidance) {
    parts.push(`[review guidance] ${f.review.guidance}`);
  }
  if (f.acceptedReason) {
    parts.push(`[accepted] ${f.acceptedReason}`);
  }
  return parts.join('\n\n');
}

function severityToSarifLevel(s: Severity): SarifLevel {
  switch (s) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'suggestion':
      return 'note';
  }
}

function toSarifUri(relPath: string): string {
  return relPath.split('\\').join('/');
}
