// Merge pipeline for layered config sources.
//
// Precedence (low → high): defaults < global < project < local < env < args.
// Within a single layer, last-wins for object fields; for arrays,
// union-then-dedupe-by-key (detect) / by-id (fix).
//
// `@group` references inside `excludePaths` are expanded here against the
// union of built-in + user-defined groups. Unknown groups throw at
// merge time — config is invalid if a rule references an undeclared
// group.

import type { RegentConfig, DetectRuleSpec, FixRuleSpec } from './schema.js';
import {
  BUILTIN_EXCLUDE_GROUPS,
  isGroupReference,
  groupNameFromReference,
  type ExcludeGroup,
} from './groups.js';

/**
 * Merge multiple config layers in precedence order. The first layer is
 * the lowest precedence (defaults), the last is the highest (args/env).
 *
 * Behaviour:
 *   - `rules.detect[]` / `rules.fix[]` — concatenated; same-id rules
 *     overridden by higher-precedence layer.
 *   - `excludePaths` — concatenated; deduplicated. `@group` references
 *     resolved against union(builtin + user-defined groups).
 *   - `excludeGroups` — merged; user-defined override builtins on
 *     conflict (logged as warning at the loader level).
 *   - Scalar fields (`cache.enabled`, `log.level`, …) — last-wins.
 */
export function mergeConfigs(layers: readonly RegentConfig[]): RegentConfig {
  if (layers.length === 0) {
    throw new Error('mergeConfigs: at least one layer required');
  }

  const detectById = new Map<string, DetectRuleSpec>();
  const fixById = new Map<string, FixRuleSpec>();

  const extendsList: Array<string | readonly unknown[]> = [];
  const disableSet = new Set<string>();
  const overrideMap = new Map<string, { severity?: 'error' | 'warning' | 'suggestion'; message?: string }>();
  const acceptList: Array<{
    ruleId: string;
    path: string;
    line?: number;
    reason: string;
    origin: 'repo' | 'local';
  }> = [];

  const excludePaths: string[] = [];
  const excludePathsSeen = new Set<string>();

  const excludeGroupsByName = new Map<string, ExcludeGroup>();
  for (const g of BUILTIN_EXCLUDE_GROUPS) {
    excludeGroupsByName.set(g.name, g);
  }

  let cache: { enabled: boolean; maxBytes: number; maxAge: number } = {
    enabled: true,
    maxBytes: 100 * 1024 * 1024,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
  let log: { level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'; format: 'text' | 'json' } = {
    level: 'info',
    format: 'text',
  };
  let output: { color: boolean; contextBuffer: number } = {
    color: true,
    contextBuffer: 3,
  };
  let runner: { concurrency: number } = {
    concurrency: 4,
  };

  for (const layer of layers) {
    // rules.detect — last-wins by id
    for (const r of layer.rules.detect) {
      detectById.set(r.id, r);
    }
    // rules.fix — last-wins by id
    for (const r of layer.rules.fix) {
      fixById.set(r.id, r);
    }

    // rules.extends — concatenate (order preserved; later wins for
    // overlapping paths in the resolver)
    for (const e of layer.rules.extends as readonly (string | readonly unknown[])[]) {
      extendsList.push(e);
    }

    // rules.disable — union (collect all ids; applied at load time)
    for (const id of layer.rules.disable) {
      disableSet.add(id);
    }

    // rules.override — last-wins by id
    for (const [id, ov] of Object.entries(layer.rules.override)) {
      const ovRaw = ov as { severity?: string; message?: string };
      overrideMap.set(id, {
        ...(ovRaw.severity !== undefined ? { severity: ovRaw.severity as 'error' | 'warning' | 'suggestion' } : {}),
        ...(ovRaw.message !== undefined ? { message: ovRaw.message } : {}),
      });
    }

    // rules.accept — union; origin = 'repo' for project-level entries
    for (const entry of layer.rules.accept) {
      acceptList.push({ ...entry, origin: 'repo' });
    }

    // excludePaths — concat + dedup + expand groups
    for (const entry of layer.excludePaths) {
      if (excludePathsSeen.has(entry)) {
        continue;
      }
      excludePathsSeen.add(entry);
      if (isGroupReference(entry)) {
        const name = groupNameFromReference(entry);
        const group = excludeGroupsByName.get(name);
        if (!group) {
          throw new Error(
            `mergeConfigs: unknown exclude group '@${name}' — declare it under 'excludeGroups' in your config`,
          );
        }
        for (const g of group.globs) {
          const resolved = `@${name}→${g}`;
          if (excludePathsSeen.has(resolved)) {
            continue;
          }
          excludePathsSeen.add(resolved);
          excludePaths.push(g);
        }
        continue;
      }
      excludePaths.push(entry);
    }

    // excludeGroups — user definitions override builtins on conflict
    for (const [name, globsRaw] of Object.entries(layer.excludeGroups)) {
      const globs = globsRaw as readonly string[];
      const existing = excludeGroupsByName.get(name);
      if (existing && existing.source === 'builtin') {
        // Replace builtin with user definition (warning emitted by
        // caller when needed — we don't have a logger here).
        excludeGroupsByName.set(name, {
          name,
          globs,
          source: 'user',
        });
      } else if (!existing) {
        excludeGroupsByName.set(name, { name, globs, source: 'user' });
      } else {
        // Existing user-defined group — last-wins
        excludeGroupsByName.set(name, { name, globs, source: 'user' });
      }
    }

    // Scalar fields — last-wins
    cache = { ...cache, ...layer.cache };
    log = { ...log, ...layer.log };
    output = { ...output, ...layer.output };
    runner = { ...runner, ...layer.runner };
  }

  const excludeGroups: Record<string, readonly string[]> = {};
  for (const [name, group] of excludeGroupsByName) {
    excludeGroups[name] = group.globs;
  }

  return {
    rules: {
      detect: [...detectById.values()],
      fix: [...fixById.values()],
      extends: extendsList,
      disable: [...disableSet],
      override: Object.fromEntries(overrideMap) as Record<string, { severity?: 'error' | 'warning' | 'suggestion'; message?: string }>,
      accept: acceptList.map(({ origin: _origin, ...rest }) => rest),
    },
    excludePaths,
    excludeGroups,
    cache,
    log,
    output,
    runner,
  };
}

/**
 * Expand a single `excludePaths` array against a known group set.
 * Returns the resolved list of globs (with `@group` entries replaced).
 * Throws if a referenced group is unknown.
 */
export function expandExcludePaths(
  paths: readonly string[],
  groups: ReadonlyMap<string, ExcludeGroup>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of paths) {
    if (!isGroupReference(entry)) {
      if (!seen.has(entry)) {
        seen.add(entry);
        out.push(entry);
      }
      continue;
    }
    const name = groupNameFromReference(entry);
    const group = groups.get(name);
    if (!group) {
      throw new Error(`expandExcludePaths: unknown group '@${name}'`);
    }
    for (const g of group.globs) {
      if (!seen.has(g)) {
        seen.add(g);
        out.push(g);
      }
    }
  }
  return out;
}
