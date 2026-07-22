// `ts.no-emit-helper` — regent dogfooding rule.
//
// Library code must not use `console.log|warn|error|info|debug`.
// Operational logs go through pino (`src/logging/index.ts`) so we
// get level filtering, structured fields, redaction, and a single
// JSON/text toggle. Bare `console.*` calls bypass all of that.
//
// The eslint config disables `no-console` because regent is a CLI
// tool — stdout/stderr are the user's data stream. This rule
// preserves that exemption for the CLI subsystem while still
// policing the library surface.
//
// Excludes:
//   - src/cli.ts — `runList` / `runExplain` / `runAccept` /
//     `runReject` and the `--llm` short-circuit all emit via
//     `console.log` (stdout = data, per CLI convention).
//   - src/cli/** — same convention applies to subcommands.
//
// NOTE: uses line comments (not JSDoc block) because Node 24's
// `--experimental-strip-types` mis-tokenizes the `**/` glob pattern
// inside `/* ... */` comments. See issue #86.

import { defineDetectRule } from '../../../dist/kinds/detect.js';

export default defineDetectRule({
  id: 'ts.no-emit-helper',
  severity: 'warning',
  pattern: '\\bconsole\\.(log|error|warn|info|debug)\\s*\\(',
  globs: ['src/**/*.ts'],
  excludePaths: [
    '@generated',
    '@node-modules',
    // CLI subsystem — stdout/stderr is the data stream here.
    'src/cli.ts',
    'src/cli/**',
    // The rules themselves reference the pattern as a regex source.
    'tools/audit/rules/**',
  ],
  message:
    'library code must not use `console.*` — go through the pino logger '
    + '(`createLogger` in `src/logging/`) for level filtering, structured '
    + 'fields, and redaction.',
  rationale:
    'Bare `console.*` calls bypass log levels, structured fields, and '
    + 'log routing. They cannot be filtered, redacted, or shipped to a '
    + 'log aggregator. The CLI subsystem legitimately emits to stdout '
    + '(data stream), so it stays excluded.',
});
