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
import { parseSource, matchRuleOnRoot } from './ast/matcher.js';
import type { CompiledAstRule } from './kinds/ast.js';
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

/** Default in-flight file scans — matches libuv's default threadpool size. */
const DEFAULT_CONCURRENCY = 4;

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

  /**
   * Maximum number of file scans in flight. Each scan does an async
   * `readFile` plus per-line RE2 work; the libuv default threadpool
   * size is 4, which is why that's the default. Override via
   * `runner.concurrency` (config), `STBL_REGENT_RUNNER_CONCURRENCY`
   * (env), or `--concurrency N` (CLI).
   *
   * Clamped to a minimum of 1.
   */
  readonly concurrency?: number;

  /** AST-kind rules (ast-grep), scanned per file alongside regex rules. */
  readonly astRules?: readonly CompiledAstRule[];
}

/**
 * A single event from `runRulesStream`: a finding as soon as it's discovered,
 * periodic progress, then a terminal `done`. Enables live output (print
 * findings + a progress indicator as scanning proceeds) instead of waiting for
 * the whole scan to finish.
 */
export type ScanEvent =
  | { readonly type: 'finding'; readonly finding: Finding }
  | { readonly type: 'progress'; readonly processed: number; readonly total: number }
  | { readonly type: 'done'; readonly scannedFiles: number };

/**
 * Streaming runner — yields each finding as soon as its file is scanned, plus
 * progress events, then `done`. Files are scanned by a bounded concurrent pool;
 * events arrive in file-completion order (not input order). `runRules` is a
 * thin collect-all wrapper over this.
 */
export async function* runRulesStream(
  rules: readonly CompiledRule[],
  scope: RunnerScope,
  options: RunOptions = {},
): AsyncGenerator<ScanEvent> {
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

  const acceptList = options.acceptList ?? [];
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const astRules = options.astRules ?? [];

  let processed = 0;
  let scannedFiles = 0;
  for await (const r of mapConcurrent(
    files,
    concurrency,
    (file) => scanFile(file, compiled, astRules, acceptList, contextBuffer),
  )) {
    processed++;
    if (r !== null) {
      scannedFiles++;
      for (const finding of r.findings) {
        yield { type: 'finding', finding };
      }
    }
    yield { type: 'progress', processed, total: files.length };
  }
  yield { type: 'done', scannedFiles };
}

export async function runRules(
  rules: readonly CompiledRule[],
  scope: RunnerScope,
  options: RunOptions = {},
): Promise<RunResult> {
  const findings: Finding[] = [];
  let scannedFiles = 0;
  for await (const ev of runRulesStream(rules, scope, options)) {
    if (ev.type === 'finding') {
      findings.push(ev.finding);
    } else if (ev.type === 'done') {
      scannedFiles = ev.scannedFiles;
    }
  }
  return { findings, rules, scannedFiles };
}

/**
 * Map `items` through `fn` with at most `limit` in flight, yielding each result
 * as its task completes (completion order, not input order).
 */
async function* mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): AsyncGenerator<R> {
  const inFlight = new Map<number, Promise<{ key: number; value: R }>>();
  let next = 0;
  const start = (): void => {
    if (next >= items.length) {
      return;
    }
    const key = next++;
    inFlight.set(key, fn(items[key]!, key).then((value) => ({ key, value })));
  };
  for (let k = 0; k < Math.min(Math.max(1, limit), items.length); k++) {
    start();
  }
  while (inFlight.size > 0) {
    const { key, value } = await Promise.race(inFlight.values());
    inFlight.delete(key);
    start();
    yield value;
  }
}

/**
 * Run an async mapping over `items` with at most `limit` tasks in
 * flight. Order of the result array matches the input order — handy
 * when callers pair positions to original items.
 *
 * Hand-rolled (no `p-limit` / `p-queue` dep). The implementation is a
 * tiny FIFO queue: kick off the first `limit` tasks, and every time a
 * task finishes, start the next one from the queue. Errors propagate
 * through `Promise.all` so a single rejection fails the whole batch —
 * matches the previous `Promise.all(files.map(...))` semantics.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) {
        return;
      }
      const item = items[i]!;
      results[i] = await fn(item, i);
    }
  };

  const workers: Promise<void>[] = [];
  for (let w = 0; w < effectiveLimit; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
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

function matchesScopePattern(spec: { readonly globs: readonly string[] }, file: string): boolean {
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
 * Phase 6: per-file work runs in parallel via a bounded pool
 * (`runWithConcurrency`) so callers can cap in-flight scans via
 * `--concurrency N` (CLI) / `runner.concurrency` (config) /
 * `STBL_REGENT_RUNNER_CONCURRENCY` (env). Default: 4 (libuv
 * threadpool size).
 */
async function scanFile(
  file: string,
  compiled: readonly CompiledRuleWithPattern[],
  astRules: readonly CompiledAstRule[],
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
  return scanFileContent(content, file, compiled, astRules, acceptList, contextBuffer);
}

/**
 * Pure per-file scan over an in-memory `content` string. Extracted
 * from `scanFile` so callers that already have the content (e.g. the
 * fixpoint re-scan in `applyFixes` after applying edits) can reuse
 * the same regex + AST pipeline without an extra disk round-trip.
 *
 * Phase 4 of the fix-mode epic (#7) introduces this seam for the
 * `applyFixes` fixpoint loop; before, only `scanFile` exposed the
 * logic and it always read from disk.
 *
 * The accept-list IS applied (review-mode findings get their normal
 * pending / accepted triage) so the re-scan mirrors the initial
 * detection. AST findings emitted here would have no fix attachment
 * (the fixer engine only handles regex-rule `RuleFixSpec` kinds), so
 * they would be deferred by the engine — the re-scan stays safe.
 */
async function scanFileContent(
  content: string,
  file: string,
  compiled: readonly CompiledRuleWithPattern[],
  astRules: readonly CompiledAstRule[],
  acceptList: readonly AcceptEntry[],
  contextBuffer: number,
): Promise<{ findings: Finding[] }> {
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

  // AST-kind rules: group by language, parse each file ONCE per language, then
  // run every rule of that language over the shared tree (parsing is the
  // expensive step; matching is cheap). A missing language pack or parse error
  // skips that language rather than failing the whole run.
  const astByLang = new Map<string, CompiledAstRule[]>();
  for (const astRule of astRules) {
    if (!matchesScopePattern(astRule.spec, file)) {
      continue;
    }
    if (matchesExcludePath(astRule.spec.excludePaths, file)) {
      continue;
    }
    const list = astByLang.get(astRule.spec.language);
    if (list) {
      list.push(astRule);
    } else {
      astByLang.set(astRule.spec.language, [astRule]);
    }
  }
  for (const [language, rulesForLang] of astByLang) {
    try {
      const root = await parseSource(language, content);
      for (const astRule of rulesForLang) {
        for (const am of matchRuleOnRoot(root, astRule.spec.ast)) {
          const startByte = (lineOffsets[am.startLine] ?? 0) + am.startColumn;
          const endByte = (lineOffsets[am.endLine] ?? 0) + am.endColumn;
          findings.push({
            ruleId: astRule.spec.id,
            severity: astRule.spec.severity,
            path: file,
            match: {
              startLine: am.startLine,
              startColumn: am.startColumn,
              endLine: am.endLine,
              endColumn: am.endColumn,
              matchText: fileLines[am.startLine] ?? am.text,
            },
            context: extractContext(content, startByte, endByte, contextBuffer),
            message: astRule.spec.message,
            source: astRule.source,
            rationale: astRule.spec.rationale,
            status: 'violation',
          });
        }
      }
    } catch {
      // Missing language pack or parse error — skip this language.
    }
  }

  return { findings };
}

/**
 * Options accepted by `detectFile` — the accept-list and context
 * buffer mirror `RunOptions`; `content` lets the fixpoint loop in
 * `applyFixes` (Phase 4 of #7) re-scan a file against its
 * post-edit in-memory content without writing it to disk first.
 */
export interface DetectFileOptions extends RunOptions {
  /**
   * Optional pre-loaded file content. When omitted, `detectFile`
   * reads the file from disk (mirroring `runRules`). When provided,
   * the disk read is skipped and the supplied content is scanned
   * directly — the canonical use is `applyFixes`'s fixpoint loop,
   * which already has the post-edit content in memory.
   */
  readonly content?: string;
}

/**
 * Per-file detection primitive (Phase 4 of the fix-mode epic, #7).
 * Runs the supplied `CompiledRule[]` (and any AST rules if the
 * `astRules` option is set) against a single file and returns the
 * findings. Compiles each rule's pattern / excludeWhen RE2 once per
 * call; for repeated scans of the same rule set, callers should
 * consider caching the compiled matchers (P5 follow-up).
 *
 * Most library callers should prefer `runRules` / `runRulesStream`
 * for whole-tree scans; `detectFile` exists for the
 * already-have-the-content case (the fixpoint loop) and for testing.
 *
 * The accept-list applies normally (review rules → `pending` /
 * `accepted`). Returns an empty array when the file is missing,
 * unreadable, or oversized — mirroring `scanFile`'s `null` contract.
 */
export async function detectFile(
  file: string,
  rules: readonly CompiledRule[],
  options: DetectFileOptions = {},
): Promise<readonly Finding[]> {
  const contextBuffer = options.contextBuffer ?? DEFAULT_CONTEXT_BUFFER;

  let content: string;
  if (options.content !== undefined) {
    content = options.content;
  } else {
    try {
      const buf = await readFile(file);
      if (buf.byteLength > MAX_FILE_BYTES) {
        return [];
      }
      content = buf.toString('utf8');
    } catch {
      return [];
    }
  }

  const compiled = await Promise.all(
    rules.map(async (entry) => {
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

  const result = await scanFileContent(
    content,
    file,
    compiled,
    options.astRules ?? [],
    options.acceptList ?? [],
    contextBuffer,
  );
  return result.findings;
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
