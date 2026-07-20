// Default exclude globs used when no project-level excludePaths are
// configured. Mirrors the v0.1 list — kept as a constant so both
// the runner and the FileScanner implementation agree on what's
// excluded by default.

export const DEFAULT_EXCLUDE_PATHS: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/bin/**',
  '**/obj/**',
  '**/.git/**',
];