// Delegate/format-mode runner (#34b).
//
// Spec authors contribute `defineFormat` (file-mutating tools) and
// `defineDelegate` (read-only analysis tools) specs — both surface
// shape is from `src/kinds/{format,delegate}.ts`. This file is the
// runtime that:
//
//   1. Refuses unsafe argv (token blocklist + first-token denylist)
//      — `~/.agents/rules/process/agent-runtime-safety.md` mandates
//      only short-lived commands; we hard-refuse `watch` / `serve` /
//      port-binding patterns before spawn.
//   2. Captures the subprocess result (`ToolProcessResult`) and hands
//      it to the spec's `normalize` callback.
//   3. Synthesises a workspace-level finding when the tool crashed /
//      no parseable output — agent-readable signal that the rule ran
//      but did not produce results, instead of crashing the run.
//
// The helpers live in this single file (rather than splitting
// `format.ts` / `delegate.ts` per the spec kind) because the runtime
// contract is the same; only the spec kinds differ at the loader /
// CLI level.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { z } from 'zod';

import type {
  DelegateRuleSpec,
} from '../kinds/delegate.js';
import type { FormatRuleSpec } from '../kinds/format.js';
import type {
  Normalize,
  ToolProcessResult,
} from '../kinds/process.js';
import type {
  Finding,
  Match,
  Severity,
} from '../types.js';

/**
 * Hard-refused argv tokens. Each entry matches the literal
 * `argv[i]` exactly. Combined with `FIRST_TOKEN_DENYLIST` this
 * covers the canonical "long-lived" patterns (dev servers,
 * file-watchers, port-binding commands) without regex complexity.
 */
export const BLOCKED_TOKENS: ReadonlySet<string> = new Set([
  '--watch',
  '--serve',
  '--port',
  '--listen',
  '--dev',
  '--daemon',
  '--keep-alive',
  '--follow',
  'serve',
  'start',
  'daemon',
  'tail',
  'watch',
]);

/**
 * First-argv-element denylist. Catches tools whose entire mode is
 * long-lived (e.g. `vite`, `next`, `ng serve`, `gatsby develop`).
 * The runner treats `argv[0]` matches as fatal even when the rest of
 * the argv is innocuous — the canonical "dev server" trap.
 */
export const FIRST_TOKEN_DENYLIST: ReadonlySet<string> = new Set([
  'vite',
  'next',
  'gatsby',
  'ng',
  'webpack-dev-server',
  'vue-cli-service',
  'webpack',
]);

/**
 * Per-invocation stdio buffer ceiling. Tool output larger than
 * this is truncated and the result flagged `truncated: true` —
 * `normalize` parsers handle the partial-input case (line-by-line
 * streaming, sentinel checks, etc.).
 */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Per-invocation wall-clock timeout. Anything slower than 5 min
 * is treated as runaway and synthesised as a failure.
 */
const MAX_DURATION_MS = 5 * 60 * 1000;

/** Result of `isSafeArgv`. `safe: false` carries a reason for the
 *  agent / human to debug. */
export interface ArgvSafetyResult {
  readonly safe: boolean;
  readonly reason: string | undefined;
}

/**
 * Reject argv with `watch` / `serve` / port-binding patterns before
 * `spawnSync`. The blocklist is intentionally a tiny fixed set
 * (see `BLOCKED_TOKENS` and `FIRST_TOKEN_DENYLIST`); tools whose
 * watch behaviour is not captured here are out of contract.
 *
 * Returns a structured result; callers either render the reason
 * directly or throw `SafetyError` to short-circuit the spec.
 */
export function isSafeArgv(argv: readonly string[]): ArgvSafetyResult {
  for (const arg of argv) {
    if (BLOCKED_TOKENS.has(arg)) {
      return {
        safe: false,
        reason: `argv contains long-lived token: '${arg}'`,
      };
    }
  }
  if (argv.length > 0 && FIRST_TOKEN_DENYLIST.has(argv[0]!)) {
    return {
      safe: false,
      reason: `argv[0] '${argv[0]}' is in the first-token denylist`,
    };
  }
  return { safe: true, reason: undefined };
}

/** Thrown by `safeSpawn` when `isSafeArgv` rejects the argv. The
 *  CLI catches and synthesises a failure finding (or surfaces the
 *  error directly to the user when no spec is associated). */
export class SafetyError extends Error {
  public readonly argv: readonly string[];
  public readonly reason: string;

  constructor(argv: readonly string[], reason: string) {
    super(`unsafe argv for '${argv[0] ?? '<empty>'}': ${reason}`);
    this.name = 'SafetyError';
    this.argv = argv;
    this.reason = reason;
  }
}

/**
 * `child_process.spawnSync` wrapper that enforces the safety
 * blocklist and captures a `ToolProcessResult`. No shell
 * interpretation (`shell: false`); we hand `spawnSync` the raw
 * argv.
 */
export function safeSpawn(argv: readonly string[]): ToolProcessResult {
  const safety = isSafeArgv(argv);
  if (!safety.safe) {
    throw new SafetyError(argv, safety.reason ?? 'unsafe argv');
  }
  if (argv.length === 0) {
    throw new SafetyError(argv, 'argv is empty');
  }
  const started = Date.now();
  const result: SpawnSyncReturns<Buffer> = spawnSync(argv[0]!, argv.slice(1), {
    shell: false,
    encoding: 'buffer',
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: MAX_DURATION_MS,
    windowsHide: true,
  });
  const durationMs = Date.now() - started;
  const stdoutBytes = result.stdout ? result.stdout.length : 0;
  const stderrBytes = result.stderr ? result.stderr.length : 0;
  return {
    argv,
    command: argv[0]!,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ? result.stdout.toString('utf8') : '',
    stderr: result.stderr ? result.stderr.toString('utf8') : '',
    durationMs,
    // `maxBuffer` truncation isn't surfaced by `spawnSync`'s return
    // shape on every Node version; assume `false` for the strict
    // ceiling here. Tools that grow past the buffer throw EAGAIN,
    // which we surface as `exitCode: null` + a synthesised failure
    // finding.
    truncated: stdoutBytes >= MAX_BUFFER_BYTES || stderrBytes >= MAX_BUFFER_BYTES,
  };
}

/**
 * Synthesise a workspace-level finding for tool failure modes
 * (crash, no parseable output, parse throw, safety rejection).
 * The finding carries `severity: 'error'` so regent exits non-zero
 * and the agent sees the failure in the report rather than as a
 * crash. `path: ''` keeps it at workspace scope (no file).
 */
export function synthesizeFailureFinding(
  ruleId: string,
  specSource: string | undefined,
  detail: string,
): Finding {
  const match: Match = {
    startLine: 0,
    startColumn: 0,
    endLine: 0,
    endColumn: 0,
    matchText: '',
    groups: [],
  };
  return {
    ruleId,
    severity: 'error' as Severity,
    path: '',
    match,
    context: { startLine: 0, endLine: 0, lines: [] },
    message: detail,
    // `Finding.source` is required; fall back to the rule id when
    // the spec author did not declare a `source`. SARIF
    // `helpUri`-style provenance is best-effort here — agents
    // reading the report can still trace via `ruleId`.
    source: specSource ?? ruleId,
    status: 'violation',
  };
}

/**
 * Materialise the per-spec `configure` value through the rule's
 * own `params.parse`. Used by both the delegate and format
 * runner paths. Returns `undefined` for specs without `params`.
 * Throws a synthesised failure finding when `params.parse` throws
 * (caller wraps and includes it in the result list) — the spec
 * author's schema is broken at config-validation time and we want
 * the agent to see it.
 */
export function materializeSpecParams(
  spec: { readonly params?: unknown },
  configureValue: unknown,
): unknown {
  const params = (spec as { readonly params?: unknown }).params;
  if (params === undefined || params === null) {
    return {};
  }
  const candidate = params as { parse?: (value: unknown) => unknown };
  if (typeof candidate.parse !== 'function') {
    throw new Error(
      'spec.params must expose a `parse(value)` method (zod schema, or a stand-in with the same surface); ' +
      'inline configs without a zod schema are not supported',
    );
  }
  return candidate.parse(configureValue ?? {});
}

/**
 * Run a single spec's `detect` argv through `safeSpawn` and feed
 * the captured `ToolProcessResult` to the spec's `normalize`.
 * Exceptions are caught and turned into a synthetic finding so the
 * runner can keep going.
 */
export function runSpecDetect(
  spec: FormatRuleSpec<z.ZodTypeAny> | DelegateRuleSpec<z.ZodTypeAny>,
  configureValue: unknown,
): readonly Finding[] {
  // Local type cast — the helpers accept either format- or
  // delegate-shaped specs and `detect` has the same shape in both.
  const detect = spec.detect as (p: unknown) => readonly string[];
  const normalize = spec.normalize as Normalize;

  let argv: readonly string[];
  try {
    const parsedParams = materializeSpecParams(spec, configureValue);
    argv = detect(parsedParams);
  } catch (err) {
    return [
      synthesizeFailureFinding(
        spec.id,
        spec.source,
        `spec '${spec.id}' config validation failed: ${(err as Error).message}`,
      ),
    ];
  }

  let proc: ToolProcessResult;
  try {
    proc = safeSpawn(argv);
  } catch (err) {
    if (err instanceof SafetyError) {
      return [
        synthesizeFailureFinding(
          spec.id,
          spec.source,
          `spec '${spec.id}' refused — ${err.reason}`,
        ),
      ];
    }
    throw err;
  }

  if (proc.signal !== null) {
    return [
      synthesizeFailureFinding(
        spec.id,
        spec.source,
        `tool '${proc.command}' killed by signal ${proc.signal} after ${proc.durationMs}ms`,
      ),
    ];
  }

  let findings: readonly Finding[];
  try {
    findings = normalize(proc);
  } catch (err) {
    return [
      synthesizeFailureFinding(
        spec.id,
        spec.source,
        `spec '${spec.id}' normalize threw: ${(err as Error).message}`,
      ),
    ];
  }

  // Empty findings + non-zero exit + no stdout/stderr → tool failed
  // without producing output. Synthesise a workspace-level finding
  // so the agent sees the failure (instead of "everything fine,
  // but exit was 1").
  if (
    findings.length === 0 &&
    proc.exitCode !== 0 &&
    !proc.stdout &&
    !proc.stderr
  ) {
    return [
      synthesizeFailureFinding(
        spec.id,
        spec.source,
        `tool '${proc.command}' exited with code ${proc.exitCode} and produced no parseable output`,
      ),
    ];
  }

  return findings;
}

/**
 * Run a format spec's `fix` argv through `safeSpawn`. Returns
 * `undefined` when the spec has no `fix` field (detect-only spec).
 * The fix is mutating by definition — the runner does NOT validate
 * tool output against the spec's `normalize` here (format-spec
 * mutates files; running its parser twice would be wasteful).
 *
 * The caller (`runFix` in `src/cli.ts`) emits findings via a
 * follow-up `runSpecDetect` after the fix so the user sees the
 * diff in the report.
 */
export function runSpecFix(
  spec: FormatRuleSpec<z.ZodTypeAny>,
  configureValue: unknown,
): readonly Finding[] {
  if (spec.fix === undefined) {
    return [];
  }
  let argv: readonly string[];
  try {
    const parsedParams = materializeSpecParams(spec, configureValue);
    argv = spec.fix(parsedParams);
  } catch (err) {
    return [
      synthesizeFailureFinding(
        spec.id,
        spec.source,
        `spec '${spec.id}' config validation failed: ${(err as Error).message}`,
      ),
    ];
  }
  try {
    safeSpawn(argv);
  } catch (err) {
    if (err instanceof SafetyError) {
      return [
        synthesizeFailureFinding(
          spec.id,
          spec.source,
          `spec '${spec.id}' fix refused — ${err.reason}`,
        ),
      ];
    }
    throw err;
  }
  return [];
}

/**
 * Run all delegate specs (workspace-level, sequential — most
 * delegate tools are language-server-equivalent and don't benefit
 * from parallelism). Findings are concatenated in spec order.
 */
export async function runDelegates(
  specs: readonly DelegateRuleSpec<z.ZodTypeAny>[],
  configure: Readonly<Record<string, unknown>>,
): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  for (const spec of specs) {
    const configuredValue = configure[spec.id];
    const findings = runSpecDetect(spec, configuredValue);
    out.push(...findings);
  }
  return out;
}

/**
 * Run all format specs in `fix` mode (mutating). For each spec
 * with `fix` defined, the runner invokes `safeSpawn(spec.fix(...))`
 * with the safety blocklist enforced. Specs without `fix` are
 * skipped — those are detect-only formats and emit findings via
 * `runSpecDetect` instead.
 *
 * Returns one synthesised finding per spec that failed safety or
 * parameter validation. Tool exit codes are NOT inspected here —
 * the mutating argv either succeeded (files changed) or the OS
 * already killed the process. The follow-up detect pass (run by
 * the caller) surfaces any drift the fix introduced.
 */
export async function runFormatFixes(
  specs: readonly FormatRuleSpec<z.ZodTypeAny>[],
  configure: Readonly<Record<string, unknown>>,
): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  for (const spec of specs) {
    if (spec.fix === undefined) continue;
    const configuredValue = configure[spec.id];
    const findings = runSpecFix(spec, configuredValue);
    out.push(...findings);
  }
  return out;
}
