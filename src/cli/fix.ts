/**
 * `regent fix` CLI subcommand — Phase 3 of the fix-mode epic (#60).
 *
 * Wraps the `applyFixes` engine from `src/fixer.ts` (P2, #59) with
 * config loading, scope filtering, a confirmation prompt, and human /
 * JSON output. Library callers can `import { applyFixes }` directly
 * — this CLI is a thin layer that honours the same options.
 *
 * Flags (P3 scope):
 *   --dry-run              show what would change; do not write
 *   --all                  apply `safety: 'suggested'` edits too (otherwise
 *                          those surface in `suggested[]` for the agent).
 *                          Note: unlike `check`, `fix` always scans the
 *                          whole tree (`changedOnly: false`) — git is
 *                          not the default undo log here because the user
 *                          is explicitly destructing files. Use `[paths...]`
 *                          to narrow the scope.
 *   --rule <id>            restrict to listed rule ids (repeatable)
 *   --filter <glob>        restrict to file paths matching glob
 *   --json                 emit machine-readable ApplyFixesResult on stdout
 *   -y, --yes              skip the interactive confirmation prompt
 *
 * Variadic positional `[paths...]` narrows the scan; default = cwd.
 *
 * Exit code:
 *   0 — all findings either applied or surfaced as suggested (no
 *       conflicting / out-of-range deferred edits)
 *   1 — at least one deferred edit with reason `overlap` (conflicting
 *       edits on the same byte span — needs user intervention) or
 *       `out-of-range` (file content changed mid-run — suggest retry).
 *
 * Deferred edits with reason `no-fix-attached` are **not** exit-1: the
 * rule fired without a `fix` attachment, which is a config-side
 * issue, not a fix-engine failure.
 *
 * Out of scope (later phases):
 *   - `--include-rules` / `--exclude-rules` (full shell-glob semantics)
 *   - function-form fix lane (P7)
 *   - per-rule `--rule` patterns (we only accept literal ids today;
 *     shell-style globs ship with the `--include-rules` round in P5)
 */

import type { Command } from 'commander';
import * as readline from 'node:readline';
import { relative, sep } from 'node:path';

import pc from 'picocolors';

import {
  applyFixes,
  type AppliedEdit,
  type ApplyFixesOptions,
  type ApplyFixesResult,
  type DeferredEdit,
  type SuggestedEdit,
} from '../fixer.js';
import { loadRules } from '../loader.js';
import { runRules } from '../runner.js';
import type {
  CompiledRule,
  RuleSpec,
  RunnerScope,
} from '../types.js';

/** Per-AST-rule and per-transform rules are out of scope for the P3
 *  fixer engine (which only consumes `RuleSpec` + `Finding`); skip
 *  them in the detection step so that we don't emit findings the
 *  engine can't act on. */
export interface FixOptions {
  dryRun?: boolean;
  all?: boolean;
  /** Repeated `--rule <id>` collection. Empty = unrestricted. */
  rule?: readonly string[];
  /** Glob matched against finding paths (relative to cwd). */
  filter?: string;
  json?: boolean;
  yes?: boolean;
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
    .description('apply auto-fixes; --dry-run for diff-only, --all for suggested lane')
    .argument('[paths...]', 'paths to scan (default: cwd)')
    .option('--dry-run', 'print what would change; do not write')
    .option('--all', 'apply safety=suggested edits (otherwise surface in suggested[])')
    .option('--rule <id>', 'restrict to one rule id (repeatable)', collectValues, [])
    .option('--filter <glob>', 'restrict to file paths matching glob (against finding path)')
    .option('--json', 'emit machine-readable JSON result on stdout')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (paths: string[], options: FixOptions) => {
      const exitCode = await runFix({ paths, options });
      process.exit(exitCode);
    });
}

/**
 * Commander's value collector for repeatable `--rule` flags.
 * Returns the accumulator plus the new value.
 */
function collectValues(value: string, prev: readonly string[]): string[] {
  return [...prev, value];
}

/**
 * Top-level orchestrator for the `fix` subcommand. Public-exported so
 * `src/cli.ts` can call it directly (and so tests can drive it under
 * a TTY-controlled `process.stdin.isTTY`).
 */
export async function runFix({ paths, options }: RunFixArgs): Promise<number> {
  const cwd = process.cwd();
  const useColor = shouldUseColor();

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
      if (options.json) {
        process.stdout.write(
          `${JSON.stringify({ applied: [], changedFiles: [], deferred: [], suggested: [], unifiedDiff: '', summary: msg }, null, 2)}\n`,
        );
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
  //    result + `summary`).
  if (findings.length === 0) {
    const empty = emptyResult();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(toJsonResult(empty, { cwd, mode: 'apply' }), null, 2)}\n`);
    } else {
      const mark = useColor ? pc.green('✓') : '✓';
      process.stdout.write(`${mark} no fixable findings\n`);
    }
    return 0;
  }

  // 7. Confirmation prompt (skipped with --yes, --dry-run, --json).
  //    Non-interactive stdin (CI / pipe) refuses ambiguous confirmation;
  //    --yes is the supported escape hatch.
  const skipPrompt =
    options.dryRun === true ||
    options.json === true ||
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
    lane: options.all === true ? 'all' : 'safe',
  };
  let fixResult: ApplyFixesResult;
  try {
    fixResult = await applyFixes(findings, rulesById, applyOptions);
  } catch (err) {
    return cliError(useColor, `applyFixes failed: ${(err as Error).message}`);
  }

  // 9. Emit output.
  if (options.json === true) {
    process.stdout.write(
      `${JSON.stringify(
        toJsonResult(fixResult, {
          cwd,
          mode: options.dryRun === true ? 'dry-run' : 'apply',
        }),
        null,
        2,
      )}\n`,
    );
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
 * Wire-format for `--json` output. Mirrors `ApplyFixesResult` 1:1 plus
 * a top-level `mode` (`'apply'` | `'dry-run'`) and a `cwd` for context.
 * Consumers can deserialise into the exported `ApplyFixesResult` and
 * read those two fields separately.
 */
interface JsonOutput {
  readonly cwd: string;
  readonly mode: 'apply' | 'dry-run';
  readonly applied: readonly AppliedEdit[];
  readonly changedFiles: readonly string[];
  readonly deferred: readonly DeferredEdit[];
  readonly suggested: readonly SuggestedEdit[];
  readonly unifiedDiff: string;
}

function toJsonResult(result: ApplyFixesResult, opts: { readonly cwd: string; readonly mode: 'apply' | 'dry-run' }): JsonOutput {
  return {
    cwd: opts.cwd,
    mode: opts.mode,
    applied: result.applied,
    changedFiles: result.changedFiles,
    deferred: result.deferred,
    suggested: result.suggested,
    unifiedDiff: result.unifiedDiff,
  };
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
    lines.push(
      `Applied: ${total} edit${totalApplied === 1 ? '' : 's'} to ${fileCount} file${fileCount === 1 ? '' : 's'}`,
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
      `Suggested: ${total} (requires --all or agent judgement)`,
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
