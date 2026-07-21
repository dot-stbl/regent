/**
 * JSON reporter for `regent check --format json`.
 *
 * Output mirrors `src/types.ts:RunResult` (top-level shape), with
 * `findings[]` shaped per the agent-facing contract documented in
 * issue #17: each entry carries `ruleId`, `severity`, `path`, `match`
 * (1-indexed line + 1-indexed column + matched text), `context`
 * (1-indexed line range + the lines themselves), `message`, `source`,
 * and `status` (`violation | pending | accepted`).
 *
 * Path normalisation: every `path` is forward-slash + repo-relative
 * (mirrors SARIF reporter behaviour for cross-platform stability).
 * Computed manually rather than via `path.relative()` because
 * `path.posix.relative` (used on Linux CI) does not recognise
 * Windows drive letters as absolute — it would emit a useless
 * `../C:/repo/...` for a `C:\repo\...` input.
 *
 * Empty results still produce a valid document:
 *   `{ rules: [], findings: [], scannedFiles: 0 }`.
 */

import type { CompiledRule, Finding, RunResult, Severity } from '../types.js';

export interface JsonReporterOptions {
  readonly cwd: string;
}

export interface JsonFindingMatch {
  readonly line: number;
  readonly column: number;
  readonly text: string;
}

export interface JsonFindingContext {
  readonly lines: readonly string[];
  readonly startLine: number;
  readonly endLine: number;
}

export interface JsonFinding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly path: string;
  readonly match: JsonFindingMatch;
  readonly context: JsonFindingContext;
  readonly message: string;
  readonly source: string;
  readonly status: 'violation' | 'pending' | 'accepted';
}

export interface JsonRuleDescriptor {
  readonly id: string;
  readonly severity: Severity;
  readonly message: string;
  readonly source: string;
}

export interface JsonRunResult {
  readonly rules: readonly JsonRuleDescriptor[];
  readonly findings: readonly JsonFinding[];
  readonly scannedFiles: number;
}

/**
 * Render findings as a stable, agent-friendly JSON document.
 *
 * The output is a plain object — callers stringify as needed. The CLI
 * writes it via `JSON.stringify(result, null, 2) + '\n'` for readability
 * (line-oriented pipe compatibility with `jq` and similar tools).
 */
export function renderJson(
  findings: readonly Finding[],
  rules: readonly CompiledRule[],
  options: JsonReporterOptions,
): JsonRunResult {
  const ruleDescriptors: JsonRuleDescriptor[] = rules.map((r) => ({
    id: r.spec.id,
    severity: r.spec.severity,
    message: r.spec.message,
    source: r.source,
  }));

  const jsonFindings: JsonFinding[] = findings.map((f) => ({
    ruleId: f.ruleId,
    severity: f.severity,
    path: toRepoRelative(f.path, options.cwd),
    match: {
      line: f.match.startLine + 1,
      column: f.match.startColumn + 1,
      text: f.match.matchText,
    },
    context: {
      lines: f.context.lines,
      startLine: f.context.startLine + 1,
      endLine: f.context.endLine + 1,
    },
    message: f.message,
    source: f.source,
    status: f.status,
  }));

  // The CLI uses `RunResult.scannedFiles` from the runner output; the
  // reporter keeps an explicit `scannedFiles` slot for compatibility
  // with the documented contract (issue #17 acceptance: top-level
  // `scannedFiles` field). The CLI patches the value from
  // `runRules().scannedFiles` before serialising.
  const result: JsonRunResult = {
    rules: ruleDescriptors,
    findings: jsonFindings,
    scannedFiles: 0,
  };
  return result;
}

/**
 * Attach the runner's `scannedFiles` count to a JSON result.
 * Returns a new object — `renderJson()` is pure and reusable in tests.
 */
export function withScannedFiles(
  result: JsonRunResult,
  scannedFiles: number,
): JsonRunResult {
  return { ...result, scannedFiles };
}

/**
 * Convenience: build the full JSON document from a `RunResult` in one
 * step. Used by the CLI dispatch in `src/cli.ts:runCheck`.
 */
export function renderJsonFromRun(
  run: RunResult,
  options: JsonReporterOptions,
): string {
  const result = withScannedFiles(
    renderJson(run.findings, run.rules, options),
    run.scannedFiles,
  );
  return JSON.stringify(result, null, 2) + '\n';
}

function toRepoRelative(filepath: string, cwd: string): string {
  const split = (s: string): readonly string[] =>
    s.split(/[\\/]+/).filter((segment) => segment.length > 0);

  const fileParts = split(filepath);
  const cwdParts = split(cwd);

  let i = 0;
  while (
    i < fileParts.length
    && i < cwdParts.length
    && fileParts[i] === cwdParts[i]
  ) {
    i++;
  }
  return fileParts.slice(i).join('/');
}