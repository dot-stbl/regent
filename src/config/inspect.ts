/**
 * `regent config show / diff / layers` — surface per-layer provenance.
 *
 * Three subcommands:
 *   - `config show <field>` — merged value + per-layer origin (path /
 *     env var name / arg flag). Walks a dotted path through the
 *     resolved config object.
 *   - `config diff` — fields where any non-default layer overrode the
 *     default, unified-diff-style (one `--- path: <dotted> / @@`
 *     block per override, plus the per-layer values).
 *   - `config layers` — list of all 5 layers in precedence order with
 *     their loaded/empty status and origin (file path / env var names
 *     / arg flags).
 *
 * The functions here are pure — they take a `LoadConfigResult` and
 * return strings. The CLI dispatcher in `src/cli.ts` handles the
 * commander wiring.
 */

import type { ConfigLayerEntry, LoadConfigResult, ResolvedConfig } from './index.js';
import { BUILTIN_EXCLUDE_GROUPS } from './groups.js';

export interface ConfigShowResult {
  readonly path: string;
  readonly merged: unknown;
  readonly perLayer: ReadonlyArray<{
    readonly id: ConfigLayerEntry['id'];
    readonly loaded: boolean;
    readonly value: unknown;
    readonly origin: string;
  }>;
}

/**
 * Walk a dotted path (e.g. `cache.enabled`, `rules.detect`) through a
 * config object. Returns `undefined` if any segment is missing.
 */
export function readPath(
  root: unknown,
  dottedPath: string,
): { ok: true; value: unknown } | { ok: false } {
  if (dottedPath === '') {
    return { ok: true, value: root };
  }
  let current: unknown = root;
  for (const segment of dottedPath.split('.')) {
    if (current === null || typeof current !== 'object') {
      return { ok: false };
    }
    const obj = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, segment)) {
      return { ok: false };
    }
    current = obj[segment];
  }
  return { ok: true, value: current };
}

/**
 * Resolve the dotted path against the merged config + each layer's
 * per-layer config (defaults to merged value when the layer didn't
 * override the field).
 */
export function showField(
  result: LoadConfigResult,
  dottedPath: string,
): ConfigShowResult | { error: 'not-found' | 'empty-path'; path: string } {
  if (!dottedPath || dottedPath.trim() === '') {
    return { error: 'empty-path', path: dottedPath };
  }
  const mergedRead = readPath(result.config, dottedPath);
  if (!mergedRead.ok) {
    return { error: 'not-found', path: dottedPath };
  }

  const perLayer = result.layers.map((layer) => {
    const perLayerConfig = layer.config ?? result.config;
    const read = readPath(perLayerConfig, dottedPath);
    return {
      id: layer.id,
      loaded: layer.loaded,
      value: read.ok ? read.value : undefined,
      origin: formatOrigin(layer),
    };
  });

  return { path: dottedPath, merged: mergedRead.value, perLayer };
}

function formatOrigin(layer: ConfigLayerEntry): string {
  if (layer.id === 'defaults') {
    return 'built-in defaults';
  }
  if (layer.id === 'env') {
    if (layer.envVars.length === 0) {
      return 'env (no STBL_REGENT_* set)';
    }
    return `env: ${layer.envVars.join(', ')}`;
  }
  if (layer.id === 'args') {
    if (layer.args.length === 0) {
      return 'args (none set)';
    }
    return `args: ${layer.args.join(', ')}`;
  }
  if (layer.path) {
    return `file: ${layer.path}`;
  }
  return layer.loaded ? 'loaded' : 'not loaded';
}

/**
 * Format `show` output as a human-readable string.
 *
 * Format:
 *   <field>: <merged-value>
 *
 *     defaults     : <value>   (built-in defaults)
 *     global       : <value>   (<file path or 'not loaded'>)
 *     project      : <value>   (<file path>)
 *     local        : <value>   (<file path>)
 *     env          : <value>   (<env var names>)
 *     args         : <value>   (<arg flags>)
 */
export function formatShow(result: ConfigShowResult): string {
  const lines: string[] = [];
  lines.push(`${result.path}: ${stringifyValue(result.merged)}`);
  lines.push('');
  for (const layer of result.perLayer) {
    const value = stringifyValue(layer.value);
    lines.push(`  ${layer.id.padEnd(10)} ${value.padEnd(28)} (${layer.origin})`);
  }
  return lines.join('\n') + '\n';
}

function stringifyValue(value: unknown): string {
  if (value === undefined) {
    return '<unset>';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  if (typeof value === 'object') {
    return '{...}';
  }
  return String(value);
}

/**
 * Per-field diff entry: a dotted path whose value in the merged
 * config differs from its value in the default config, with the
 * per-layer values that contributed.
 */
export interface ConfigDiffEntry {
  readonly path: string;
  readonly defaultValue: unknown;
  readonly mergedValue: unknown;
  readonly contributions: ReadonlyArray<{
    readonly id: ConfigLayerEntry['id'];
    readonly value: unknown;
    readonly loaded: boolean;
  }>;
}

/**
 * Walk the merged config object recursively and emit every leaf path
 * whose value differs from the default. Object paths are joined with
 * `.`. Arrays are treated as leaves (we don't drill in — the user can
 * `config show rules.detect` for content).
 */
export function diffFromDefaults(
  result: LoadConfigResult,
): readonly ConfigDiffEntry[] {
  const defaultLayer = result.layers.find((l) => l.id === 'defaults');
  if (!defaultLayer || !defaultLayer.config) {
    return [];
  }
  // Effective defaults = `defaultConfig()` + built-in exclude groups.
  // The merge pipeline always seeds `excludeGroupsByName` with the
  // built-ins, so any non-default group entry in the merged config is
  // genuinely an override — but the `defaults` layer's config alone
  // reports `excludeGroups: {}`. We add the built-ins here so the diff
  // doesn't spuriously flag them as overrides.
  const effectiveDefaults: ResolvedConfig = {
    ...defaultLayer.config,
    excludeGroups: Object.fromEntries(
      BUILTIN_EXCLUDE_GROUPS.map((g) => [g.name, g.globs] as const),
    ),
  };
  const entries: ConfigDiffEntry[] = [];
  walk(result.config, '', effectiveDefaults, result.layers, entries);
  // Sort for stable output.
  return entries.slice().sort((a, b) => a.path.localeCompare(b.path));
}

function walk(
  current: unknown,
  prefix: string,
  defaultValue: unknown,
  layers: readonly ConfigLayerEntry[],
  out: ConfigDiffEntry[],
): void {
  if (current === null || typeof current !== 'object') {
    if (!valuesEqual(current, defaultValue)) {
      out.push({
        path: prefix || '<root>',
        defaultValue,
        mergedValue: current,
        contributions: layers.map((l) => ({
          id: l.id,
          value: readPathOrUndef(l.config, prefix),
          loaded: l.loaded,
        })),
      });
    }
    return;
  }
  if (Array.isArray(current)) {
    if (!arraysEqualShallow(current as readonly unknown[], asArray(defaultValue))) {
      out.push({
        path: prefix || '<root>',
        defaultValue,
        mergedValue: current,
        contributions: layers.map((l) => ({
          id: l.id,
          value: readPathOrUndef(l.config, prefix),
          loaded: l.loaded,
        })),
      });
    }
    return;
  }
  // Object: recurse into each key.
  const currentObj = current as Record<string, unknown>;
  const defaultObj = (defaultValue !== null && typeof defaultValue === 'object'
    ? (defaultValue as Record<string, unknown>)
    : {});
  const keys = new Set<string>([
    ...Object.keys(currentObj),
    ...Object.keys(defaultObj),
  ]);
  for (const key of keys) {
    const childPath = prefix === '' ? key : `${prefix}.${key}`;
    walk(currentObj[key], childPath, defaultObj[key], layers, out);
  }
}

function readPathOrUndef(root: unknown, path: string): unknown {
  if (!root || path === '') {
    return root;
  }
  const r = readPath(root, path);
  return r.ok ? r.value : undefined;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      return arraysEqualShallow(a as readonly unknown[], b as readonly unknown[]);
    }
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

function arraysEqualShallow(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!valuesEqual(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Format the diff as a unified-diff style string. One `---` block per
 * path. We intentionally keep it readable in a terminal — no actual
 * diff library because the input is small (a handful of scalar overrides).
 */
export function formatDiff(entries: readonly ConfigDiffEntry[]): string {
  if (entries.length === 0) {
    return 'no overrides — all fields at defaults\n';
  }
  const lines: string[] = [];
  lines.push(`--- ${entries.length} field(s) overridden ---`);
  lines.push('');
  for (const entry of entries) {
    lines.push(`--- ${entry.path}`);
    lines.push(`@@ default -> merged @@`);
    lines.push(`- ${stringifyValue(entry.defaultValue)}`);
    lines.push(`+ ${stringifyValue(entry.mergedValue)}`);
    for (const c of entry.contributions) {
      if (!c.loaded) continue;
      const loadedVal = stringifyValue(c.value);
      if (loadedVal === stringifyValue(entry.defaultValue)) continue;
      lines.push(`    ${c.id.padEnd(10)} ${loadedVal}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Format the layers list as a human-readable string.
 *
 * Format:
 *   5 config layers (low → high precedence):
 *     defaults   loaded   (built-in defaults)
 *     global     <status> (<file path>)
 *     project    <status> (<file path>)
 *     local      <status> (<file path>)
 *     env        <status> (<env var names>)
 *     args       <status> (<arg flags>)
 */
export function formatLayers(layers: readonly ConfigLayerEntry[]): string {
  const lines: string[] = [];
  lines.push(`${layers.length} config layers (low → high precedence):`);
  lines.push('');
  for (const layer of layers) {
    const status = layer.loaded ? 'loaded' : 'empty';
    lines.push(`  ${layer.id.padEnd(10)} ${status.padEnd(8)} (${formatOrigin(layer)})`);
  }
  return lines.join('\n') + '\n';
}

/** Suppress unused-import warning when consumers don't reference ResolvedConfig directly. */
export type { ResolvedConfig };