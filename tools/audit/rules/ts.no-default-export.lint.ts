// `ts.no-default-export` — regent dogfooding rule.
//
// Library source should use named exports only. Default exports hurt
// tree-shaking, force awkward imports in barrel files, and make
// refactor diffs noisier (every rename of the default becomes a
// site-wide diff). The eslint config (`eslint.config.js`) is silent
// here, so this rule backstops the convention for our own code.
//
// Line-anchored RE2: matches the literal `export default ` at the
// start of a line. The CLI entry file (src/cli.ts) and the rule
// files themselves are excluded — src/cli.ts contains a template
// literal that generates *other* code with `export default`, and
// the rules under tools/audit/rules/ legitimately export a default
// to satisfy the loader's contract.
//
// Scoped to src/**/*.ts only — tests, examples, and the rule files
// are not in scope.
//
// NOTE: uses line comments (not JSDoc block) because Node 24's
// `--experimental-strip-types` mis-tokenizes the `**/` glob pattern
// inside `/* ... */` comments. See issue #86.

import { defineDetectRule } from '../../../dist/kinds/detect.js';

export default defineDetectRule({
  id: 'ts.no-default-export',
  severity: 'warning',
  pattern: '^export default ',
  globs: ['src/**/*.ts'],
  excludePaths: [
    '@generated',
    '@node-modules',
    // src/cli.ts line ~1005 embeds `export default defineConfig({...})`
    // inside a writeFileSync template literal — the literal is the
    // *generated* starter config, not our library surface.
    'src/cli.ts',
    // The rules themselves export a default to satisfy the loader.
    'tools/audit/rules/**',
  ],
  message:
    'use a named export instead of `export default` — aids tree-shaking, '
    + 'refactor diffs, and barrel re-exports.',
  rationale:
    'Named exports keep the public surface explicit. Default exports '
    + 'force consumers to invent a local name and make rename refactors '
    + 'noisier (every import site changes). The eslint config does not '
    + 'enforce this — this regent rule is the team-wide backstop.',
});
