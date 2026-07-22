// Shared result type for the `defineFormat` / `defineDelegate`
// normalizer contract (#34a).
//
// The runner produces one `ToolProcessResult` per spec invocation
// (see 34b for the `safeInvokeDelegate` wrapper) and hands it to
// the spec's `normalize: (proc) => Finding[]` callback. Spec
// authors — both inline in `.regentrc.ts` and across bundled
// npm packages — consume this shape; `regent` itself only
// produces it, never reads it.
//
// Authoring note: keep `normalize` pure. The function is called
// once per spec invocation; its return value is the spec's sole
// contribution to the regent report. Side effects (writing files,
// shelling out again) are out of contract; if you need to do more
// than parse, raise the issue in #34's tracking.

import type { Finding } from '../types.js';

/**
 * Captured tool subprocess result. Every field is the rendered
 * output of `child_process.spawnSync` (`shell: false`); the runner
 * does no further processing before handing the value to
 * `normalize`. Tool authors see exactly what the OS returned.
 */
export interface ToolProcessResult {
  /**
   * The literal argv that was executed, as passed to the runner.
   * The runner does NOT resolve binaries; this is whatever the
   * spec author's `detect` / `fix` returned.
   */
  readonly argv: readonly string[];

  /** `argv[0]` for error messages. Equivalent to `process.argv0`-style. */
  readonly command: string;

  /** Process exit code. `null` when the process was killed by a signal. */
  readonly exitCode: number | null;

  /** Signal name when the process was killed by a signal. */
  readonly signal: NodeJS.Signals | null;

  /** Captured stdout, decoded as UTF-8 (lossy). */
  readonly stdout: string;

  /** Captured stderr, decoded as UTF-8 (lossy). */
  readonly stderr: string;

  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;

  /**
   * `true` when the runner hit the `maxBuffer` ceiling on stdout
   * or stderr. When set, `stdout` / `stderr` are truncated to the
   * buffer cap and the parser is responsible for handling partial
   * output (e.g. via line-by-line streaming JSON or sentinel
   * checks for a leading `{`).
   */
  readonly truncated: boolean;
}

/**
 * The `normalize` shape every format / delegate spec implements.
 * Spec authors write the parser; reg-as-orchestrator just routes
 * the captured `ToolProcessResult` here. Bundles (`@scope/regent-
 * delegate-dotnet` and friends — see #23 plugin resolve) ship
 * built-in normalizers for the common tools; custom specs in
 * `tools/audit/<name>.format.ts` provide their own.
 */
export type Normalize<TFinding extends Finding = Finding> = (
  proc: ToolProcessResult,
) => readonly TFinding[];
