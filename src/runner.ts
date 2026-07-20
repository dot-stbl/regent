/**
 * Runner — applies a compiled rule set to a scope of files.
 *
 * Inputs: `CompiledRule[]` from the loader + a `RunnerScope` describing
 * what files to scan. Output: `Finding[]` with context windows ready
 * for the reporter.
 *
 * ReDoS safety: every pattern is RE2-compiled ahead of time. Line-by-line
 * scan gives predictable per-line cost.
 *
 * **Tri-state review handling:** an accept-list (typically loaded via
 * `loadRules().acceptList`) is matched against each finding's
 * `(ruleId, path, line)`. Matching entries drop the finding
 * (`status: 'accepted'`). Non-review rules produce
 * `status: 'violation'` (subject to `--exit-on`). Review rules produce
 * `status: 'pending'` regardless of accept match.
 *
 * Context window: `match.startLine - contextBuffer` to
 * `match.endLine + contextBuffer` (where `contextBuffer` comes from
 * `RunOptions.contextBuffer`, defaulting to `DEFAULT_CONTEXT_BUFFER`).
 * For single-line matches this produces `2 * contextBuffer + 1` lines
 * of context; multi-line matches naturally extend because `endLine`
 * falls past the match's last line.
 *
 * The CLI threads `resolvedConfig.output.contextBuffer` (which the
 * `STBL_REGENT_OUTPUT_CONTEXT_BUFFER` env var or `.regentrc.ts` may
 * override) into `RunOptions.contextBuffer`; the default applies when
 * neither sets it.
 */

import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { simpleGit } from 'simple-git';

import { DEFAULT_CONTEXT_BUFFER } from './constants.js';
import {
  compileRegex,
  extractContext,
  type RegexMatcher,
} from './regex.js';
import type {
  AcceptEntry,
  CompiledRule,
  Finding,
  Match,
  RuleOrigin,
  RuleSpec,
  RunnerScope,
  RunResult,
} from './types.js';

const MAX_FILE_BYTES = 1_000_000; // 1MB cap per file

export interface RunOptions {
  /** Accept-list from the loader; silences matching pending findings. */
  readonly acceptList?: readonly AcceptEntry[];

  /**
   * Lines of context to include before/after each match in a finding.
   * Source for the value is the resolved config
   * (`output.contextBuffer`), which the env var
   * `STBL_REGENT_OUTPUT_CONTEXT_BUFFER` may override. Defaults to
   * `DEFAULT_CONTEXT_BUFFER` (3) when omitted — preserves v0.1/v0.2
   * behaviour for callers that don't load config.
   */
  readonly contextBuffer?: number;
}

export async function runRules(
  rules: readonly CompiledRule[],
  scope: RunnerScope,
  options: RunOptions = {},
): Promise<RunResult> {
  const contextBuffer = options.contextBuffer ?? DEFAULT_CONTEXT_BUFFER;
  const files = await collectFiles(scope);
  const compiled = await Promise.all(
    rules.map(async (entry) => {
      // Accept both CompiledRule (`{spec, source, origin}`) and flat
      // RuleSpec (the output of `defineRule(...)`). Normalise.
      const spec: RuleSpec = isCompiledRule(entry) ? entry.spec : entry;
      const origin: RuleOrigin = isCompiledRule(entry)
        ? entry.origin
        : { kind: 'repo', path: '<caller>' };
      const source: string = isCompiledRule(entry)
        ? entry.source
        : spec.source ?? '<caller>';

      return {
        spec,
        origin,
        source,
        pattern: await compileRegex(spec.pattern, { multiline: true }),
        exclude: spec.excludeWhen
          ? await compileRegex(spec.excludeWhen, { multiline: true })
          : null,
      };
    }),
  );

  const findings: Finding[] = [];
  let scannedFiles = 0;
  const acceptList = options.acceptList ?? [];

  const scanResults = await Promise.all(
    files.map((file) => scanFile(file, compiled, acceptList, contextBuffer)),
  );
  for (const r of scanResults) {
    if (r === null) {
      continue;
    }
    scannedFiles++;
    findings.push(...r.findings);
  }

  return {
    findings,
    rules,
    scannedFiles,
  };
}

/**
 * Returns the first accept-list entry matching
 * `(ruleId, line, path-glob)`, or null. Entry line may be omitted
 * (whole-file accept); entry path is a glob against the absolute path.
 *
 * Both paths are normalized to forward slashes before glob comparison —
 * `tinyglobby.glob` returns forward-slash paths on Windows while
 * `path.join` produces backslashes, so a naive string compare fails.
 */
function findAcceptMatch(
  accepts: readonly AcceptEntry[],
  ruleId: string,
  path: string,
  line: number,
): AcceptEntry | null {
  const normalizedPath = path.split(/[\\/]/).join('/');
  for (const entry of accepts) {
    if (entry.ruleId !== ruleId) {
      continue;
    }
    if (entry.line !== undefined && entry.line !== line) {
      continue;
    }
    const normalizedEntryPath = entry.path.split(/[\\/]/).join('/');
    if (!globMatches(normalizedEntryPath, normalizedPath)) {
      continue;
    }
    return entry;
  }
  return null;
}

async function collectFiles(scope: RunnerScope): Promise<string[]> {
  const { cwd } = scope;

  if (scope.changedOnly) {
    return await collectChangedFiles(cwd, scope.diffBase);
  }

  const { glob } = await import('tinyglobby');
  return await glob(scope.includeGlobs, {
    cwd,
    absolute: true,
    ignore: scope.excludeGlobs as string[],
    onlyFiles: true,
  });
}

async function collectChangedFiles(cwd: string, baseRef: string): Promise<string[]> {
  try {
    const git = simpleGit({ baseDir: cwd });
    const diff = await git.diff([`${baseRef}..HEAD`, '--name-only', '--no-renames']);
    const staged = await git.diff(['--cached', '--name-only', '--no-renames']);
    const unstaged = await git.diff(['--name-only', '--no-renames']);

    const all = new Set<string>(
      [...diff.split('\n'), ...staged.split('\n'), ...unstaged.split('\n')]
        .filter((line) => line.trim() !== '')
        .map((line) => join(cwd, line)),
    );

    return [...all];
  } catch {
    return [];
  }
}

function matchesScopePattern(spec: RuleSpec, file: string): boolean {
  const normalized = file.split(sep).join('/');
  return spec.globs.some((g) => globMatches(g, normalized));
}

function matchesExcludePath(patterns: readonly string[] | undefined, file: string): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  const normalized = file.split(sep).join('/');
  return patterns.some((p) => globMatches(p, normalized));
}

function globMatches(pattern: string, file: string): boolean {
  const regex = globToRegExp(pattern);
  return regex.test(file);
}

function globToRegExp(glob: string): RegExp {
  let body = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      body += '.*';
      i += 2;
      if (glob[i] === '/') {
        i++;
      }
    } else if (c === '*') {
      body += '[^/]*';
      i++;
    } else if (c === '?') {
      body += '[^/]';
      i++;
    } else if (c === '.') {
      body += '\\.';
      i++;
    } else if (c === '/') {
      body += '/';
      i++;
    } else {
      body += escapeRegexChar(c!);
      i++;
    }
  }
  return new RegExp('^' + body + '$');
}

function escapeRegexChar(c: string): string {
  const meta = new Set(['\\', '+', '(', ')', '|', '^', '$', '{', '}', '[', ']', '#']);
  return meta.has(c) ? '\\' + c : c;
}

function isCompiledRule(value: unknown): value is CompiledRule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return 'spec' in obj
    && 'origin' in obj
    && 'source' in obj;
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

/**
 * Internal type — line-level match carrying byte offsets for context
 * extraction. The runner converts to the public `Match` type before
 * returning findings.
 */
interface LineMatch {
  readonly lineIndex: number;
  readonly line: string;
  readonly byteOffsetStart: number;
  readonly byteOffsetEnd: number;
}

/**
 * The runner compiles each rule's `pattern` / `excludeWhen` exactly
 * once via RE2, then reuses the compiled matchers across every file.
 * This internal shape carries the compiled matchers alongside the
 * spec + origin so `scanFile` can apply them without re-compiling.
 */
interface CompiledRuleWithPattern {
  readonly spec: RuleSpec;
  readonly source: string;
  readonly origin: RuleOrigin;
  readonly pattern: RegexMatcher;
  readonly exclude: RegexMatcher | null;
}

/**
 * Scan a single file against all rules. Returns null when the file is
 * unreadable or oversized — caller increments the scanned counter only
 * for successful reads.
 *
 * Phase 6: per-file work runs in parallel via `Promise.all(files.map(scanFile))`
 * — I/O concurrency uses Node's libuv threadpool.
 */
async function scanFile(
  file: string,
  compiled: readonly CompiledRuleWithPattern[],
  acceptList: readonly AcceptEntry[],
  contextBuffer: number,
): Promise<{ findings: Finding[] } | null> {
  let content: string;
  try {
    const buf = await readFile(file);
    if (buf.byteLength > MAX_FILE_BYTES) {
      return null;
    }
    content = buf.toString('utf8');
  } catch {
    return null;
  }

  const findings: Finding[] = [];
  const fileLines = content.split('\n');
  const lineOffsets = computeLineOffsets(fileLines);

  for (const ruleEntry of compiled) {
    if (!matchesScopePattern(ruleEntry.spec, file)) {
      continue;
    }
    if (matchesExcludePath(ruleEntry.spec.excludePaths, file)) {
      continue;
    }

    const findingsFromFile = scanLineByLine(
      ruleEntry.pattern,
      ruleEntry.exclude,
      lineOffsets,
      content,
    );

    for (const m of findingsFromFile) {
      const window = extractContext(
        content,
        m.byteOffsetStart,
        m.byteOffsetEnd,
        contextBuffer,
      );

      // Precise span + capture-group values of the first match on the
      // line. `firstMatch` re-runs the compiled RE2 via `exec`; it returns
      // null only if the pattern no longer matches (it just did in
      // `scanLineByLine`), in which case we fall back to the whole line.
      const hit = ruleEntry.pattern.firstMatch(m.line);
      const match: Match = {
        startLine: m.lineIndex,
        startColumn: hit ? hit.start : 0,
        endLine: m.lineIndex,
        endColumn: hit ? hit.end : m.line.length,
        matchText: m.line,
        ...(hit ? { groups: hit.groups } : {}),
      };

      const isReview = ruleEntry.spec.review?.enabled === true;
      const exitBehavior = ruleEntry.spec.review?.exitBehavior ?? 'no-fail';
      const guidance = ruleEntry.spec.review?.guidance;

      // Accept-list match — drops the finding (records reason for audit).
      const acceptHit = !isReview
        ? null
        : findAcceptMatch(acceptList, ruleEntry.spec.id, file, m.lineIndex + 1);

      const status: Finding['status'] = acceptHit
        ? 'accepted'
        : isReview
          ? 'pending'
          : 'violation';

      const finding: Finding = {
        ruleId: ruleEntry.spec.id,
        severity: ruleEntry.spec.severity,
        path: file,
        match,
        context: window,
        message: ruleEntry.spec.message,
        source: ruleEntry.source,
        rationale: ruleEntry.spec.rationale,
        status,
        ...(isReview
          ? {
              review: {
                ...(guidance !== undefined ? { guidance } : {}),
                exitBehavior,
              },
            }
          : {}),
        ...(acceptHit ? { acceptedReason: acceptHit.reason } : {}),
      };

      findings.push(finding);
    }
  }

  return { findings };
}

/**
 * Scan a file line-by-line against the rule's pattern.
 *
 * Multi-line patterns aren't supported in the runner — authors compose
 * per-line patterns (or use excludeWhen to filter per-line). This keeps
 * the runner predictable and ReDoS-safe.
 */
function scanLineByLine(
  pattern: RegexMatcher,
  exclude: RegexMatcher | null,
  lineOffsets: readonly number[],
  content: string,
): readonly LineMatch[] {
  const lines = content.split('\n');
  const matches: LineMatch[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? '';
    if (!pattern.test(line)) {
      continue;
    }
    if (exclude && exclude.test(line)) {
      continue;
    }
    matches.push({
      lineIndex: lineIdx,
      line,
      byteOffsetStart: lineOffsets[lineIdx] ?? 0,
      byteOffsetEnd: (lineOffsets[lineIdx] ?? 0) + line.length,
    });
  }
  return matches;
}

export function severityAtOrAbove(severity: string, threshold: string): boolean {
  const order = ['suggestion', 'warning', 'error'];
  return order.indexOf(severity) >= order.indexOf(threshold);
}

export function relativePath(scope: RunnerScope, absPath: string): string {
  return relative(scope.cwd, absPath);
}
