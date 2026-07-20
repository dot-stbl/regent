// Built-in exclude groups.
//
// Reference any of these from a rule's `excludePaths` or the project
// config's `excludePaths` by prefixing the name with `@`. Examples:
//
//   excludePaths: ['@generated', '**/legacy/**']
//
// User-defined groups may be added in `regent.config.ts` under the
// `excludeGroups` field; they override built-ins on conflict (and emit
// a warning so silent overrides don't hide config drift).

export type ExcludeGroupName = string;

export interface ExcludeGroup {
  readonly name: ExcludeGroupName;
  readonly globs: readonly string[];
  readonly source: 'builtin' | 'user';
}

export const BUILTIN_EXCLUDE_GROUPS: readonly ExcludeGroup[] = [
  {
    name: 'generated',
    globs: ['**/*.g.cs', '**/*.Designer.cs', '**/*.designer.cs', '**/Generated/**', '**/__generated__/**'],
    source: 'builtin',
  },
  {
    name: 'migrations',
    globs: ['**/Migrations/**', '**/Migration.cs', '**/*Migration.cs'],
    source: 'builtin',
  },
  {
    name: 'build-output',
    globs: ['**/bin/**', '**/obj/**', '**/dist/**', '**/build/**', '**/out/**'],
    source: 'builtin',
  },
  {
    name: 'node-modules',
    globs: ['**/node_modules/**'],
    source: 'builtin',
  },
  {
    name: 'git',
    globs: ['**/.git/**'],
    source: 'builtin',
  },
  {
    name: 'ide',
    globs: ['**/.vscode/**', '**/.idea/**', '**/*.swp'],
    source: 'builtin',
  },
  {
    name: 'vendored',
    globs: ['**/vendor/**', '**/third_party/**', '**/external/**'],
    source: 'builtin',
  },
];

/**
 * Find a built-in exclude group by name (without `@` prefix). Returns
 * undefined when not present — caller decides whether that's an error
 * (config validation) or warning (single-rule reference at scan time).
 */
export function findBuiltinGroup(name: string): ExcludeGroup | undefined {
  return BUILTIN_EXCLUDE_GROUPS.find((g) => g.name === name);
}

/**
 * Recognised group prefix. Used to detect `@name` references inside
 * `excludePaths` arrays before glob evaluation.
 */
export const GROUP_PREFIX = '@';

/**
 * Test whether `value` looks like a group reference (starts with `@`
 * followed by at least one character that is not a path separator).
 */
export function isGroupReference(value: string): boolean {
  if (!value.startsWith(GROUP_PREFIX)) {
    return false;
  }
  const name = value.slice(GROUP_PREFIX.length);
  return name.length > 0 && !name.includes('/') && !name.includes('\\');
}

/**
 * Extract the group name from a reference. Caller must first verify
 * via `isGroupReference`. Returns the bare name (no `@` prefix).
 */
export function groupNameFromReference(value: string): string {
  return value.slice(GROUP_PREFIX.length);
}
