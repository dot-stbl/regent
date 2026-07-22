#!/usr/bin/env -S node
// `regent describe` — JSON Schema introspection for parameterised
// rules (#33c of the config-plugins cluster).
//
//   regent describe [<ruleId>]   human-readable text (default)
//   regent describe <ruleId> --format json   machine-readable
//
// Without a rule id, lists every parameterised rule id (one per
// line). With a rule id, emits the rule's static fields (severity,
// globs, source) and its `params` zod schema as JSON Schema via
// zod 4's native `z.toJSONSchema` (`zod-to-json-schema` 3.x targets
// the zod v3 internal `_def` shape and silently emits `{}` for a
// v4 schema, so we use the in-tree converter). The output also
// includes a sample `rules.configure` block so an LLM agent or a
// human can fill in values without re-reading the rule source —
// the sample lists every schema property with its default (where the
// schema supplies one) or a `// required` marker when it doesn't.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { z } from 'zod';
import type { Command } from 'commander';

import { loadRules, type LoaderRuleSet } from '../loader.js';
import type { Severity } from '../types.js';
import type { ParameterisedRuleSnapshot } from '../loader/parameterize.js';
import { renderBanner } from './banner.js';
import { flushAndExit } from '../logging/index.js';

export type DescribeFormat = 'text' | 'json';

export interface ParameterisedRuleInfo {
  readonly id: string;
  readonly severity: Severity;
  readonly globs: readonly string[];
  readonly source: string;
  readonly rationale: string | undefined;
  readonly paramsJsonSchema: string;
  readonly sampleConfigure: string;
}

/**
 * Walk the loader's pre-materialisation snapshots and build the
 * display-friendly info rows for `regent describe`. The snapshot
 * is captured at step 4b *before* materialisation drops the `params`
 * field from the live `RuleSpec`; that means `describe` can render
 * the JSON Schema and the sample `rules.configure` block even
 * after the runner has only string-typed fields at hand.
 */
export function buildParameterisedRuleInfo(
  ruleSet: LoaderRuleSet,
): readonly ParameterisedRuleInfo[] {
  return ruleSet.parameterisedRules.map(buildInfoFromSnapshot);
}

function buildInfoFromSnapshot(
  snapshot: ParameterisedRuleSnapshot,
): ParameterisedRuleInfo {
  return {
    id: snapshot.id,
    severity: snapshot.severity,
    globs: snapshot.globs,
    source: snapshot.source,
    rationale: snapshot.rationale,
    paramsJsonSchema: renderParamsSchemaFromSnapshot(snapshot),
    sampleConfigure: renderSampleConfigureFromSnapshot(snapshot),
  };
}

/**
 * Convert a `params` zod schema (from the pre-materialisation
 * snapshot) to a JSON Schema (draft-2020-12) via zod 4's native
 * `z.toJSONSchema`. Empty string when the conversion fails — the
 * text renderer falls back to a hand-rolled message.
 */
function renderParamsSchemaFromSnapshot(
  snapshot: ParameterisedRuleSnapshot,
): string {
  try {
    return JSON.stringify(z.toJSONSchema(snapshot.params), null, 2);
  } catch {
    return '';
  }
}

/**
 * Walk the snapshot's `params` schema `shape()` and emit each key
 * with its `.default()` value (when the rule author declared one).
 * The output is JSON-stringified; missing / undefined defaults
 * are silently skipped — the agent falls back to the JSON Schema
 * for required-vs-optional analysis.
 */
function renderSampleConfigureFromSnapshot(
  snapshot: ParameterisedRuleSnapshot,
): string {
  try {
    // zod 4 exposes `shape` as a property (record of field schemas),
    // not a method. Older code paths treat it as `shape()` — try
    // both so the helper works against zod 3 + zod 4 snapshots.
    const probed = snapshot.params as unknown as {
      shape?: Record<string, z.ZodTypeAny> | (() => Record<string, z.ZodTypeAny>);
    };
    const shape =
      typeof probed.shape === 'function'
        ? (probed.shape as () => Record<string, z.ZodTypeAny>)()
        : probed.shape;
    if (!shape || typeof shape !== 'object') {
      return '{}';
    }
    const stub: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(shape)) {
      const def = (field as unknown as { _def?: unknown })._def;
      if (!def || typeof def !== 'object') continue;
      // zod 4's `_def.defaultValue` is a getter that returns the
      // resolved default value (a number / boolean / object — never a
      // function). zod 3's `_def.defaultValue` is the factory function
      // that returns the default. We try both shapes so this helper
      // works against either major version.
      const defRecord = def as Record<string, unknown>;
      const candidate = defRecord['defaultValue'];
      if (typeof candidate === 'function') {
        try {
          const value = (candidate as () => unknown)();
          if (value !== undefined) stub[key] = value;
        } catch {
          // Skip unparseable defaults — the JSON Schema carries the
          // type and required-ness information for the agent.
        }
      } else if (candidate !== undefined) {
        stub[key] = candidate;
      }
    }
    return JSON.stringify(stub);
  } catch {
    return '{}';
  }
}

/** Render a single rule's text view (`regent describe <id>` — format text). */
export function renderRuleText(info: ParameterisedRuleInfo): string {
  const lines: string[] = [];
  lines.push(`=== ${info.id} ===`);
  lines.push('');
  lines.push(`severity: ${info.severity}`);
  lines.push(`globs:    ${JSON.stringify([...info.globs])}`);
  if (info.rationale) {
    lines.push('');
    lines.push(info.rationale);
  }
  lines.push('');
  lines.push('params (zod schema → JSON Schema):');
  lines.push(info.paramsJsonSchema || '  (schema introspection unavailable for this rule — open an issue)');
  if (info.source) {
    lines.push('');
    lines.push(`source:   ${info.source}`);
  }
  lines.push('');
  lines.push('rules.configure:');
  lines.push(`  '${info.id}': ${info.sampleConfigure || '{}'}`);
  return `${lines.join('\n')}\n`;
}

/** Render a single rule's JSON view (`regent describe <id> — format json). */
export function renderRuleJson(info: ParameterisedRuleInfo): Record<string, unknown> {
  let paramsSchema: unknown = null;
  if (info.paramsJsonSchema) {
    try {
      paramsSchema = JSON.parse(info.paramsJsonSchema);
    } catch {
      paramsSchema = info.paramsJsonSchema;
    }
  }
  let paramsDefault: unknown = {};
  if (info.sampleConfigure) {
    try {
      paramsDefault = JSON.parse(info.sampleConfigure);
    } catch {
      paramsDefault = info.sampleConfigure;
    }
  }
  const out: Record<string, unknown> = {
    id: info.id,
    severity: info.severity,
    globs: [...info.globs],
    params: paramsSchema,
  };
  if (info.rationale !== undefined) out['rationale'] = info.rationale;
  if (info.source) out['source'] = info.source;
  out['configure'] = { [info.id]: paramsDefault };
  return out;
}

interface DescribeOptions {
  readonly cwd?: string;
  readonly format?: DescribeFormat;
  readonly configPath?: string;
}

/** Top-level entry — shared between the CLI command and tests. */
export async function runDescribe(
  ruleId: string | undefined,
  options: DescribeOptions,
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? join('tools', 'audit', 'config.ts');
  if (
    !existsSync(join(cwd, configPath))
    && !existsSync(join(cwd, '.regentrc.js'))
    && !existsSync(join(cwd, '.regentrc.mjs'))
    && !existsSync(join(cwd, '.regentrc.cjs'))
  ) {
    process.stderr.write(
      `regent: no config at <cwd>/${configPath} or <cwd>/.regentrc.{ts,js,mjs,cjs}; nothing to describe.\n`,
    );
    return 2;
  }
  let loaderResult: LoaderRuleSet;
  try {
    loaderResult = await loadRules({ repoRoot: cwd, skipLocal: true });
  } catch (err) {
    process.stderr.write(`regent: ${(err as Error).message}\n`);
    return 2;
  }

  const all = buildParameterisedRuleInfo(loaderResult);
  const format: DescribeFormat = options.format ?? 'text';

  if (ruleId === undefined) {
    process.stdout.write(
      all.length === 0
        ? '(no parameterised rules loaded — see CONTRIBUTING.md §"Authoring a parameterized rule")\n'
        : `${all.map((info) => `${info.id} — ${info.severity} (${info.globs.join(', ')})`).join('\n')}\n`,
    );
    return 0;
  }

  const matches = all.filter((info) => info.id === ruleId);
  if (matches.length === 0) {
    process.stderr.write(
      `regent: no parameterised rule with id '${ruleId}'. Try \`regent describe\` for the full list.\n`,
    );
    return 2;
  }
  const target = matches[0]!;
  process.stdout.write(
    format === 'json'
      ? `${JSON.stringify(renderRuleJson(target), null, 2)}\n`
      : renderRuleText(target),
  );
  return 0;
}

/**
 * Register `regent describe` on a Commander program. Wired into
 * `src/cli.ts`; tests invoke `runDescribe()` directly.
 */
export function registerDescribeCommand(program: Command): void {
  const describe = program
    .command('describe [ruleId]')
    .description('Show JSON Schema + a sample `rules.configure` block for a parameterised rule.')
    .option('--config <path>', 'config path', 'tools/audit/config.ts')
    .option('--scope <dir>', 'scope directory', '.')
    .option('--format <fmt>', 'output format (text|json)', 'text');
  describe.addHelpText('beforeAll', renderBanner({ useColor: pc.isColorSupported }));
  describe.action(async (ruleId: string | undefined, options: {
    config?: string;
    scope?: string;
    format?: DescribeFormat;
  }) => {
    const code = await runDescribe(ruleId, {
      cwd: options.scope ?? process.cwd(),
      configPath: options.config ?? 'tools/audit/config.ts',
      ...(options.format !== undefined ? { format: options.format } : {}),
    });
    await flushAndExit(code);
  });
}
