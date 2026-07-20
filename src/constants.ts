/**
 * Default context buffer for findings — see Plan §"Code context".
 *
 * The runner shows `match.startLine - N` to `match.endLine + N` lines
 * around each match. Single-line matches produce 2*N+1 lines of context;
 * multi-line matches produce (match.length + 2*N) lines.
 *
 * Hardcoded: the CLI does not expose a `--context` flag. The value is
 * chosen to match `grep -C 3` and `diff -U 3` — the universal default
 * in CLI tooling.
 */
export const DEFAULT_CONTEXT_BUFFER = 3;
