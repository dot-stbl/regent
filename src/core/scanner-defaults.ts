// Default exclude globs used when no project-level excludePaths are
// configured. Mirrors the v0.1 list — kept as a constant so both
// the runner and the FileScanner implementation agree on what's
// excluded by default.

/**
 * Default exclude globs applied when no project-level `excludePaths`
 * are configured. Mirrors the v0.1 list. Both the runner and the
 * `TsFileScanner` consult this list so they agree on what is excluded
 * by default (build output, VCS metadata, dependencies).
 */
export const DEFAULT_EXCLUDE_PATHS: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/bin/**',
  '**/obj/**',
  '**/.git/**',
];