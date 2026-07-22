// `ts.no-process-exit-in-lib` — regent dogfooding rule.
//
// Library modules must not call `process.exit()` directly. The CLI
// subsystem is the only place that legitimately terminates the
// process — and even there, `src/cli/exit.ts` wraps the call in
// `flushAndExit()` so the pino logger drains before shutdown
// (fixes the Windows libuv crash from #88 / #79).
//
// Background: before #79, helpers deep in the library would call
// `process.exit()` mid-flow, bypassing pino's pending writes and
// crashing on Windows. This rule catches any new helper that
// reaches for `process.exit()` instead of bubbling up an exit code
// to the CLI.
//
// Excludes:
//   - src/cli.ts — the `--llm` pre-parse short-circuit runs before
//     the logger exists, so it calls `process.exit(0)` directly.
//   - src/cli/** — the CLI subsystem (incl. `flushAndExit` in
//     `src/cli/exit.ts`) is where process termination lives.
//
// NOTE: uses line comments (not JSDoc block) because Node 24's
// `--experimental-strip-types` mis-tokenizes the `**/` glob pattern
// inside `/* ... */` comments. See issue #86.

import { defineDetectRule } from '../../../dist/kinds/detect.js';

export default defineDetectRule({
  id: 'ts.no-process-exit-in-lib',
  severity: 'warning',
  pattern: '\\bprocess\\.exit\\s*\\(',
  globs: ['src/**/*.ts'],
  excludePaths: [
    '@generated',
    '@node-modules',
    // CLI subsystem — legitimate owner of process termination.
    'src/cli.ts',
    'src/cli/**',
    // The rules themselves reference the pattern as a regex source.
    'tools/audit/rules/**',
  ],
  message:
    'library code must not call `process.exit()` — return / throw and '
    + 'let `src/cli/exit.ts#flushAndExit` terminate the process so the '
    + 'pino logger can drain (see #79, #88).',
  rationale:
    'Calling `process.exit()` from a library helper bypasses the '
    + 'logger drain (Windows libuv crash) and breaks the call-graph '
    + '(a deep helper cannot decide to end the program). The CLI '
    + 'subsystem is the single owner of process termination.',
});
