/**
 * Startup progress — a one-line timing summary for slow rule loads.
 *
 * `regent` reads ~60+ `.lint.ts` / `.rule.ts` files from disk on
 * startup. On a fast machine this is sub-second, but with a large
 * `~/.agents/rules/` or a slow disk it can be 1-2s. A 1-2s blank
 * screen is a UX dead spot — the user wonders if the process hung.
 *
 * The fix is a single dim line on stderr when the load exceeds
 * `SLOW_LOAD_THRESHOLD_MS`:
 *
 *   regent: loaded 67 rules in 1.42s
 *
 * Sub-second loads stay silent (no overhead, no noise). `--quiet`
 * opts out for users who want a totally clean stderr.
 *
 * No fancy progress bar — terminal escape codes are fragile across
 * shells, CI runners, and the wide matrix of regent's deployment
 * surfaces. One line of text is the right shape for this signal.
 */

import pc from 'picocolors';

/** Sub-second loads are silent. */
export const SLOW_LOAD_THRESHOLD_MS = 500;

/**
 * Shape we read from a `LoaderRuleSet`. Defined as a minimal interface
 * (not the full `LoaderRuleSet` import) so the helper is trivially
 * unit-testable without dragging the loader + config graph in.
 */
export interface RuleSetLike {
  readonly rules: readonly unknown[];
  readonly astRules: readonly unknown[];
  readonly transformRules: readonly unknown[];
}

/**
 * Run a rule-loader function, time it, and emit a dim stderr line if
 * the load is slow. Returns the loader's result unchanged.
 *
 * Behaviour:
 *   - elapsed < threshold   → silent
 *   - elapsed >= threshold  → one line on stderr, dim-styled
 *   - `quiet: true`         → always silent
 *
 * The `thresholdMs` option exists for tests — production callers leave
 * it unset and the default `SLOW_LOAD_THRESHOLD_MS` applies.
 */
export async function loadRulesWithProgress<T extends RuleSetLike>(
  load: () => Promise<T>,
  options: { readonly quiet: boolean; readonly thresholdMs?: number },
): Promise<T> {
  const start = performance.now();
  const result = await load();
  const elapsedMs = performance.now() - start;
  const threshold = options.thresholdMs ?? SLOW_LOAD_THRESHOLD_MS;
  if (!options.quiet && elapsedMs >= threshold) {
    const count = result.rules.length + result.astRules.length + result.transformRules.length;
    const seconds = (elapsedMs / 1000).toFixed(2);
    process.stderr.write(`${pc.dim(`regent: loaded ${count} rules in ${seconds}s`)}\n`);
  }
  return result;
}
