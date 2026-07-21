/**
 * `regent fix` CLI subcommand — Phase 3 + 4 + 5 of the fix-mode epic (#60, #61, #62).
 *
 * Wraps the `applyFixes` engine from `src/fixer.ts` (P2 #59, P4 #61)
 * with config loading, scope filtering, a confirmation prompt, and
 * human / JSON output. Library callers can `import { applyFixes }`
 * directly — this CLI is a thin layer that honours the same options.
 *
 * Flags (P3 + P4 + P5 scope):
 *   --dry-run              show what would change; do not write
 *   --unsafe               apply function-form and `safety: 'suggested'`
 *                          edits; prints a review-diff safety note.
 *   --all                  DEPRECATED alias for `--unsafe`; kept until v2.
 *   --rule <id>            restrict to listed rule ids (repeatable)
 *   --filter <glob>        restrict to file paths matching glob
 *   --format text|json     output format (default text). `json` emits
 *                          the v1 wire document (#62) — see
 *                          `src/reporter/fix-schema.ts`.
 *   --json                 DEPRECATED alias for `--format json`. Emits a
 *                          one-line stderr warning; will be removed in
 *                          the v2 cycle. New agents should use
 *                          `--format json` directly.
 *   --max-passes <n>       fixpoint iterations for converging rules (P4).
 *                          Default: 5. Pass `1` to disable the fixpoint
 *                          (single-pass semantics). Capped at 20.
 *   -y, --yes              skip the interactive confirmation prompt
 *
 * Variadic positional `[paths...]` narrows the scan; default = cwd.
 *
 * Exit code:
 *   0 — all findings either applied or surfaced as suggested (no
 *       conflicting / out-of-range deferred edits, no convergence
 *       error)
 *   1 — at least one deferred edit with reason `overlap` (conflicting
 *       edits on the same byte span — needs user intervention) or
 *       `out-of-range` (file content changed mid-run — suggest retry),
 *       OR the fixpoint exceeded `--max-passes` (convergence error).
 *
 * Deferred edits with reason `no-fix-attached` are **not** exit-1: the
 * rule fired without a `fix` attachment, which is a config-side
 * issue, not a fix-engine failure.
 *
 * Out of scope (later phases):
 *   - `--include-rules` / `--exclude-rules` (full shell-glob semantics)
 *   - per-rule `--rule` patterns (we only accept literal ids today;
 *     shell-style globs ship with the `--include-rules` round in P5)
 */

import type { Command } from 'commander';
import * as readline from 'node:readline';
import { relative, sep } from 'node:path';

import pc from 'picocolors';

import {
  applyFixes,
  APPLY_FIXES_DEFAULT_MAX_PASSES,
  APPLY_FIXES_MAX_PASSES_CAP,
  ApplyFixesConvergenceError,
  type ApplyFixesOptions,
  type ApplyFixesResult,
} from '../fixer.js';
import { loadRules } from '../loader.js';
import { runRules } from '../runner.js';
import type {
  CompiledRule,
  Finding,
  RuleSpec,
  RunnerScope,
} from '../types.js';
import { toV1Json } from '../reporter/fix-schema.js';

/** Per-AST-rule and per-transform rules are out of scope for the P3
 *  fixer engine (which only consumes `RuleSpec` + `Finding`); skip
 *  them in the detection step so that we don't emit findings the
 *  engine can't act on. */
export interface FixOptions {
  dryRun?: boolean;
  /** Deprecated alias for `--unsafe`. */
  all?: boolean;
  unsafe?: boolean;
  /** Repeated `--rule <id>` collection. Empty = unrestricted. */
  rule?: readonly string[];
  /** Glob matched against finding paths (relative to cwd). */
  filter?: string;
  /** Output format (P5 #62). Default `text`. */
  format?: 'text' | 'json';
  /** Deprecated alias for `--format json`. */
  json?: boolean;
  yes?: boolean;
  /** Fixpoint iteration cap for converging rules (Phase 4 of #7). */
  maxPasses?: number;
}

export interface RunFixArgs {
  readonly paths: readonly string[];
  readonly options: FixOptions;
}

const EXCLUDE_GLOBS: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/bin/**',
  '**/obj/**',
  '**/.git/**',
];

/**
 * Register the `fix` subcommand on the given commander root.
 *
 * Follows the same split-out pattern as `src/cli/banner.ts` — the
 * fix flow is small-but-not-trivial (~100 lines) and earns its own
 * file. The action handler resolves the exit code; the caller of
 * `program.parseAsync` will pass that through.
 */
export function registerFixCommand(program: Command): void {
  program
    .command('fix')
    .description('apply auto-fixes; --dry-run for diff-only, --unsafe for function fixes, --max-passes <n> for fixpoint')
    .argument('[paths...]', 'paths to scan (default: cwd)')
    .option('--dry-run', 'print what would change; do not write')
    .option('--unsafe', 'enable function-form and safety=suggested fixes; review the diff')
    .option('--all', 'DEPRECATED alias for --unsafe (will be removed in v2)')
    .option('--rule <id>', 'restrict to one rule id (repeatable)', collectValues, [])
    .option('--filter <glob>', 'restrict to file paths matching glob (against finding path)')
    .option('--format <fmt>', 'output format: text|json (default text)')
    .option('--json', 'DEPRECATED alias for --format json (prints a stderr warning)')
    .option(
      '--max-passes <n>',
      `fixpoint iterations for converging rules (default: ${APPLY_FIXES_DEFAULT_MAX_PASSES}, max: ${APPLY_FIXES_MAX_PASSES_CAP})`,
      parseMaxPasses,
    )
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (paths: string[], options: FixOptions) => {
      const exitCode = await runFix({ paths, options });
      process.exit(exitCode);
    });
}

/**
 * Commander option-parser for `--max-passes <n>`. Rejects non-positive
 * values (the engine clamps internally to `>= 1`, but a stray `--max-passes 0`
 * would silently disable the loop; better to fail loud at the CLI edge).
 */
function parseMaxPasses(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`--max-passes must be a positive integer (got '${value}')`);
  }
  return n;
}

/**
 * Commander's value collector for repeatable `--rule` flags.
 * Returns the accumulator plus the new value.
 */
function collectValues(value: string, prev: readonly string[]): string[] {
  return [...prev, value];
}

function resolveLane(options: FixOptions): 'safe' | 'all' {
  if (options.unsafe === true) {
    process.stderr.write('note: --unsafe enables function-form fixes; review the diff before committing\n');
  }
  if (options.all === true) {
    process.stderr.write('warning: --all is deprecated, use --unsafe (will be removed in v2)\n');
  }
  return options.unsafe === true || options.all === true ? 'all' : 'safe';
}

/**
 * Resolve the effective output format. `--json` is a deprecated alias
 * for `--format json` (P5 #62) — both set the same output branch,
 * but the deprecated flag surfaces a one-line stderr warning so
 * downstream consumers can move forward to `--format json` over time.
 */
function resolveFormat(
  options: FixOptions,
  useColor: boolean,
): 'text' | 'json' {
  if (options.json === true) {
    process.stderr.write(
      `${useColor ? pc.yellow('warning:') : 'warning:'} --json is deprecated, use --format json (P5 of #62)\n`,
    );
    return 'json';
  }
  if (options.format === 'json') {
    return 'json';
  }
  if (options.format !== undefined && options.format !== 'text') {
    process.stderr.write(
      `${useColor ? pc.yellow('warning:') : 'warning:'} --format ${options.format} is not recognised, falling back to text\n`,
    );
  }
  return 'text';
}

/**
 * Top-level orchestrator for the `fix` subcommand. Public-exported so
 * `src/cli.ts` can call it directly (and so tests can drive it under
 * a TTY-controlled `process.stdin.isTTY`).
 */
export async function runFix({ paths, options }: RunFixArgs): Promise<number> {
  const cwd = process.cwd();
  const useColor = shouldUseColor();
  const format = resolveFormat(options, useColor);
  const lane = resolveLane(options);
  const isJson = format === 'json';

  // 1. Load rules + config
  let loaded: Awaited<ReturnType<typeof loadRules>>;
  try {
    loaded = await loadRules({ repoRoot: cwd });
  } catch (err) {
    return cliError(useColor, `failed to load rules: ${(err as Error).message}`);
  }

  let rules: readonly CompiledRule[] = loaded.rules;
  if (options.rule && options.rule.length > 0) {
    const ids = new Set(options.rule);
    rules = rules.filter((r) => ids.has(r.spec.id));
    if (rules.length === 0) {
      // `--rule` filtered everything out — exit 0 with a clear line
      // (mirrors `check`'s behaviour on an empty match).
      const msg = `no rules matched --rule ${options.rule.join(', ')}`;
      if (isJson) {
        const emptyDoc = toV1Json(emptyResult());
        process.stdout.write(`${JSON.stringify(emptyDoc, null, 2)}\n`);
      } else {
        process.stdout.write(`${pc.yellow('~')} ${msg}\n`);
      }
      return 0;
    }
  }

  // 2. Build RunnerScope. Variadic [paths...] narrows the scan via
  //    includeGlobs — when empty, default to the project root.
  const includeGlobs: readonly string[] = paths.length > 0 ? paths : ['**/*'];
  const scope: RunnerScope = {
    cwd,
    includeGlobs,
    excludeGlobs: EXCLUDE_GLOBS,
    // `fix` defaults to whole-tree scan: unlike `check` (a passive
    // observation tool), `fix` is destructive and the user is
    // explicitly opting in. `--all` does NOT change the scan mode
    // here — its single semantic is "also apply suggested lane"
    // (see the lane= options below). If the user wants git-changed
    // only, they constrain via `[paths...]` (pass explicit file/dir
    // arguments).
    changedOnly: false,
    diffBase: 'HEAD',
  };

  // 3. Detect (regex rules only — applyFixes does not yet understand
  //    AST / transform rule shapes).
  let result: Awaited<ReturnType<typeof runRules>>;
  try {
    result = await runRules(rules, scope, {
      acceptList: loaded.acceptList,
      contextBuffer: loaded.resolvedConfig.output.contextBuffer,
      concurrency: loaded.resolvedConfig.runner.concurrency,
    });
  } catch (err) {
    return cliError(useColor, `failed to run detection: ${(err as Error).message}`);
  }

  // 4. Filter findings: violations only, then --filter glob against
  //    the file path (relative to cwd, slash-normalized).
  let findings = result.findings.filter((f) => f.status === 'violation');
  if (options.filter) {
    findings = findings.filter((f) => matchesFilter(f.path, cwd, options.filter!));
  }

  // 5. Build the rulesById map the fixer engine consumes. The runner
  //    returns the post-filter rule set; we re-key by id so the engine
  //    can do per-finding lookups.
  const rulesById = new Map<string, RuleSpec>();
  for (const r of result.rules) {
    rulesById.set(r.spec.id, r.spec);
  }

  // 6. Pre-apply summary. If there's nothing to fix, exit 0 with an
  //    idempotent "nothing to do" line (JSON consumers get an empty
  //    v1 document).
  if (findings.length === 0) {
    if (isJson) {
      const emptyDoc = toV1Json(emptyResult());
      process.stdout.write(`${JSON.stringify(emptyDoc, null, 2)}\n`);
    } else {
      const mark = useColor ? pc.green('✓') : '✓';
      process.stdout.write(`${mark} no fixable findings\n`);
    }
    return 0;
  }

  // 7. Confirmation prompt (skipped with --yes, --dry-run, --format json).
  //    Non-interactive stdin (CI / pipe) refuses ambiguous confirmation;
  //    --yes is the supported escape hatch.
  const skipPrompt =
    options.dryRun === true ||
    isJson ||
    options.yes === true;
  if (!skipPrompt) {
    if (process.stdin.isTTY !== true) {
      return cliError(
        useColor,
        'non-interactive stdin; pass --yes to skip the confirmation prompt',
      );
    }
    const proceed = await confirmPrompt(
      `Apply ${findings.length} fix(es)? [y/N] `,
    );
    if (!proceed) {
      process.stdout.write('aborted\n');
      return 0;
    }
  }

  // 8. Run the engine.
  const applyOptions: ApplyFixesOptions = {
    cwd,
    dryRun: options.dryRun === true,
    lane,
    ...(options.maxPasses !== undefined ? { maxPasses: options.maxPasses } : {}),
    acceptList: loaded.acceptList,
    contextBuffer: loaded.resolvedConfig.output.contextBuffer,
  };
  let fixResult: ApplyFixesResult;
  try {
    fixResult = await applyFixes(findings, rulesById, applyOptions);
  } catch (err) {
    if (err instanceof ApplyFixesConvergenceError) {
      // Surface the convergence error to stderr + exit 1 so CI
      // catches looping rules. The original error's `stats` field
      // carries the per-file diagnostic for programmatic consumers.
      process.stderr.write(
        `${useColor ? pc.red('error: convergence') : 'error: convergence'}: ${err.message}\n`,
      );
      return 1;
    }
    return cliError(useColor, `applyFixes failed: ${(err as Error).message}`);
  }

  // 9. Emit output.
  if (isJson) {
    // v1 wire document — see `src/reporter/fix-schema.ts` and
    // `assets/llm/schema/fix-v1.json`. The context lines on each
    // suggested entry come from the runner's `Finding.context` —
    // we look them up by `(path, ruleId, range)` so the agent sees
    // the same ±contextBuffer window the text reporter prints.
    const doc = toV1JsonWithContext(fixResult, findings);
    process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderHuman(fixResult, { cwd, useColor })}\n`);
  }

  // 10. Exit code per spec.
  return hasConflictingDeferred(fixResult) ? 1 : 0;
}

/**
 * `no-fix-attached` deferred edits are not exit-1 (config issue),
 * only `overlap` / `out-of-range` are.
 */
function hasConflictingDeferred(result: ApplyFixesResult): boolean {
  return result.deferred.some(
    (d) => d.reason === 'overlap' || d.reason === 'out-of-range',
  );
}

function emptyResult(): ApplyFixesResult {
  return {
    applied: [],
    changedFiles: [],
    deferred: [],
    suggested: [],
    unifiedDiff: '',
    passes: 0,
  };
}

/**
 * Match a finding's absolute path against a glob supplied on the CLI.
 * Normalizes Windows backslashes to forward slashes so globs using a
 * `double-star-slash-foo.ts` shape work the same on all platforms.
 * Supports `**`, single `*`, and `?`; everything else is literal.
 */
function matchesFilter(absPath: string, cwd: string, filter: string): boolean {
  const relPath = relative(cwd, absPath).split(sep).join('/');
  const normalizedFilter = filter.split(sep).join('/');
  // Translate glob → regex with `**` handled before `*` so the
  // single-star replacement doesn't eat the double-star prefix.
  const escaped = normalizedFilter
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DBL_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DBL_STAR__/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`).test(relPath);
}

function shouldUseColor(): boolean {
  if (process.env['NO_COLOR']) {
    return false;
  }
  return pc.isColorSupported;
}

function cliError(useColor: boolean, message: string, code = 1): number {
  process.stderr.write(`${useColor ? pc.red('error') : 'error'}: ${message}\n`);
  return code;
}

/**
 * Confirm-on-stdin prompt. Returns true on `y` / `yes` (case-insensitive);
 * false on empty input, `n`, EOF, or any other answer.
 */
function confirmPrompt(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Build a v1 document and then enrich each suggested entry with the
 * corresponding `Finding.context.lines` so the agent sees the same
 * ±contextBuffer window the text reporter prints. The lookup is
 * keyed by `(file, ruleId, range)` — the engine preserves the
 * `Finding.match` byte offsets through to the `SuggestedEdit.range`,
 * so the mapping is one-to-one for findings whose engine state
 * survived the apply pass.
 */
function toV1JsonWithContext(
  result: ApplyFixesResult,
  findings: readonly Finding[],
): ReturnType<typeof toV1Json> {
  const base = toV1Json(result);
  if (base.suggested.length === 0) {
    return base;
  }

  // Build a quick lookup keyed by (path, ruleId, start). Multiple
  // findings on the same file+ruleId are disambiguated by the
  // match's byte start.
  const byKey = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.path}\u0000${f.ruleId}\u0000${f.match.startLine}\u0000${f.match.startColumn}`;
    byKey.set(key, f);
  }

  const enriched = base.suggested.map((s) => {
    // Match by start offset — `SuggestedEdit.range` is the post-edit
    // byte span the engine computed, but for the same rule/match the
    // Finding's `match.startLine/startColumn` uniquely identifies it.
    const candidates = findings.filter(
      (f) => f.path === s.file && f.ruleId === s.ruleId,
    );
    if (candidates.length === 0) {
      return s;
    }
    // If only one candidate, take it. Otherwise pick the one whose
    // range.start is closest to the suggested range's start.
    const pick = candidates.length === 1
      ? candidates[0]!
      : candidates.reduce((best, cur) => {
        const bestDist = Math.abs(best.match.startColumn - s.range.start);
        const curDist = Math.abs(cur.match.startColumn - s.range.start);
        return curDist < bestDist ? cur : best;
      });
    return { ...s, context: pick.context.lines };
  });

  return { ...base, suggested: enriched };
}

/**
 * Human-readable summary. Three counts (applied / deferred / suggested)
 * + per-file lines from the engine's `unifiedDiff` field (the engine
 * emits `--- <file> (<N> edit(s))` lines — sufficient for a dry-run
 * preview; full unified-diff rendering lands with the SARIF round in
 * P6).
 */
function renderHuman(
  result: ApplyFixesResult,
  opts: { readonly cwd: string; readonly useColor: boolean },
): string {
  const { useColor } = opts;
  const totalApplied = result.applied.length;
  const totalDeferred = result.deferred.length;
  const totalSuggested = result.suggested.length;
  const fileCount = result.changedFiles.length;

  const lines: string[] = [];
  const mark = (label: string, value: number, color: (s: string) => string): string => {
    const formatted = useColor ? color(String(value)) : String(value);
    return `${label} ${formatted}`;
  };

  if (totalApplied > 0) {
    const total = useColor ? pc.green(String(totalApplied)) : String(totalApplied);
    // Surface the fixpoint iteration count when the engine did
    // more than one pass — single-pass runs are the common case
    // and don't need the extra verbosity.
    const passesSuffix = result.passes > 1
      ? ` across ${result.passes} pass${result.passes === 1 ? '' : 'es'}`
      : '';
    lines.push(
      `Applied: ${total} edit${totalApplied === 1 ? '' : 's'} to ${fileCount} file${fileCount === 1 ? '' : 's'}${passesSuffix}`,
    );
  } else {
    lines.push('Applied: 0 edits');
  }

  if (totalDeferred > 0) {
    lines.push(mark('Deferred:', totalDeferred, pc.yellow));
  }

  if (totalSuggested > 0) {
    const total = useColor ? pc.cyan(String(totalSuggested)) : String(totalSuggested);
    lines.push(
      `Suggested: ${total} (requires --unsafe or agent judgement)`,
    );
  }

  if (result.unifiedDiff.length > 0) {
    lines.push('');
    lines.push('Changed files:');
    for (const line of result.unifiedDiff.split('\n')) {
      if (line.length === 0) {
        continue;
      }
      lines.push(`  ${line}`);
    }
  }

  if (totalApplied === 0 && totalDeferred === 0 && totalSuggested === 0) {
    lines.push('(nothing to do)');
  }

  if (totalDeferred > 0) {
    const overlapping = result.deferred.filter((d) => d.reason === 'overlap').length;
    const outOfRange = result.deferred.filter((d) => d.reason === 'out-of-range').length;
    const noFix = result.deferred.filter((d) => d.reason === 'no-fix-attached').length;
    const breakdown: string[] = [];
    if (overlapping > 0) {
      breakdown.push(`${overlapping} overlap`);
    }
    if (outOfRange > 0) {
      breakdown.push(`${outOfRange} out-of-range`);
    }
    if (noFix > 0) {
      breakdown.push(`${noFix} no-fix-attached`);
    }
    if (breakdown.length > 0) {
      lines.push(`  (${breakdown.join('; ')})`);
    }
  }

  return lines.join('\n');
}
