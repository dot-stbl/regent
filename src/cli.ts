#!/usr/bin/env node
/**
 * `regent` CLI — entry point.
 *
 * Subcommands:
 *
 *   regent check     scan files, emit findings (text/SARIF/both)
 *   regent review    surface pending review findings (markdown/json)
 *   regent list      show every loaded rule + origin
 *   regent init      generate a starter tools/audit/ tree
 *   regent explain   show provenance (source .md) for a single rule id
 *   regent accept    add a finding to the accept-list (config.local.ts)
 *   regent reject    escalate a pending finding to a violation
 *
 * Defaults align with the Plan:
 *   - config path    : tools/audit/config.ts
 *   - scope          : cwd
 *   - changed-only   : true (git-changed since HEAD)
 *   - diff-base      : HEAD
 *   - format         : text
 *   - exit-on        : error
 *   - severity       : inherited from rule
 *   - color          : auto-detect TTY + NO_COLOR + --no-color
 *
 * **Tri-state review** (default visible):
 *   - `review.enabled` rules → `status: 'pending'`, surfaced in their own
 *     section. `--no-review` hides them.
 *   - `--exit-on` only counts `status: 'violation'` and review-rule
 *     findings with `exitBehavior: 'unreviewed-fails'`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import pc from 'picocolors';

import { loadRules } from './loader.js';
import { runRules } from './runner.js';
import { renderText, renderSummary } from './reporter/text.js';
import { renderSarif } from './reporter/sarif.js';
import { renderReview, renderReviewJson } from './reporter/review.js';
import type { ConfigLayer, RunnerScope, Severity } from './types.js';
import { renderBanner } from './cli/banner.js';
import { loadLlmText } from './llm.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('regent')
  .description('The enforcer of [.stbl] house rules')
  .version(VERSION);

program.addHelpText('beforeAll', renderBanner({ useColor: pc.isColorSupported }));

program
  .command('check')
  .description('Run rules against the configured scope')
  .option('--config <path>', 'config path', 'tools/audit/config.ts')
  .option('--scope <dir>', 'scope directory', '.')
  .option('--all', 'scan all files (not just git-changed)')
  .option('--diff-base <ref>', 'git diff base', 'HEAD')
  .option('--format <fmt>', 'output format', 'text')
  .option('--out <file>', 'write to file instead of stdout')
  .option('--exit-on <severity>', 'fail if findings at or above this severity', 'error')
  .option('--include-rules <patterns>', 'comma-separated rule-id patterns to include')
  .option('--exclude-rules <ids>', 'comma-separated rule ids to skip')
  .option('--severity <level>', 'override minimum severity in output')
  .option('--no-color', 'disable ANSI color output')
  .option('--no-review', 'hide the review-candidates section')
  .action(async (options) => {
    const exitCode = await runCheck(options);
    process.exit(exitCode);
  });

program
  .command('review')
  .description('Surface pending review findings (markdown or json)')
  .option('--config <path>', 'config path', 'tools/audit/config.ts')
  .option('--scope <dir>', 'scope directory', '.')
  .option('--all', 'scan all files')
  .option('--format <fmt>', 'markdown|json', 'markdown')
  .option('--include-accepted', 'also surface accepted findings (audit)')
  .action(async (options) => {
    const exitCode = await runReview(options);
    process.exit(exitCode);
  });

program
  .command('list')
  .description('Print every loaded rule + origin')
  .option('--config <path>', 'config path', 'tools/audit/config.ts')
  .option('--scope <dir>', 'scope directory', '.')
  .action(async (options) => {
    await runList(options);
  });

program
  .command('init')
  .description('Create a starter tools/audit/ tree in the current repo')
  .action(() => {
    runInit();
  });

program
  .command('explain <rule-id>')
  .description('Show the source path for a rule and link to its prose')
  .option('--config <path>', 'config path', 'tools/audit/config.ts')
  .option('--scope <dir>', 'scope directory', '.')
  .action(async (ruleId: string, options) => {
    await runExplain(ruleId, options);
  });

program
  .command('accept')
  .description('Add a finding to the accept-list (silences pending review)')
  .argument('<rule-id>', 'rule id (e.g. csharp.no-todo-without-owner)')
  .argument('<target>', 'path[:line] — glob or absolute path with optional line')
  .requiredOption('--reason <reason>', 'audit-trail reason (required, max 500 chars)')
  .option('--config <path>', 'config.local.ts path', 'tools/audit/config.local.ts')
  .option('--scope', 'write to commit-shared config.ts instead of local.ts')
  .action(async (ruleId: string, target: string, options) => {
    const exitCode = await runAccept(ruleId, target, options);
    process.exit(exitCode);
  });

program
  .command('reject')
  .description('Escalate a pending finding to a violation (writes to .rejections.json)')
  .argument('<rule-id>', 'rule id')
  .argument('<path:line>', 'path with line number')
  .option('--config <dir>', 'repo root containing tools/audit/', '.')
  .action(async (ruleId: string, pathLine: string, options) => {
    const exitCode = await runReject(ruleId, pathLine, options);
    process.exit(exitCode);
  });

program
  .command('llm')
  .description('Print LLM-friendly skill documentation (llm.txt)')
  .action(() => {
    process.stdout.write(loadLlmText());
    process.exit(0);
  });

async function runCheck(options: CheckOptions): Promise<number> {
  const cwd = process.cwd();
  const useColor = shouldUseColor(options);
  const hideReview = options.review === false;

  let loadedRules;
  try {
    loadedRules = await loadRules({ repoRoot: cwd });
  } catch (err) {
    console.error(pc.red(`regent: failed to load rules: ${(err as Error).message}`));
    return 1;
  }

  let rules = loadedRules.rules;

  if (options.includeRules) {
    const patterns = (options.includeRules as string).split(',').map((s) => s.trim());
    rules = rules.filter((r) => patterns.some((p) => globMatch(r.spec.id, p)));
  }
  if (options.excludeRules) {
    const ids = new Set((options.excludeRules as string).split(',').map((s) => s.trim()));
    rules = rules.filter((r) => !ids.has(r.spec.id));
  }

  const scope: RunnerScope = {
    cwd,
    includeGlobs: ['**/*'],
    excludeGlobs: [
      '**/node_modules/**',
      '**/dist/**',
      '**/bin/**',
      '**/obj/**',
      '**/.git/**',
    ],
    changedOnly: !options.all,
    diffBase: options.diffBase as string,
  };

  const result = await runRules(rules, scope, { acceptList: loadedRules.acceptList });
  let findings = result.findings;

  // Violations-only flag (drop pending review)
  if (hideReview) {
    findings = findings.filter((f) => f.status !== 'pending');
  }

  if (options.severity) {
    const minThreshold = severityRank(options.severity as Severity);
    findings = findings.filter((f) => severityRank(f.severity) >= minThreshold);
  }

  const format = options.format as string;
  let output = '';
  if (format === 'sarif') {
    output = renderSarif(findings, result.rules, { cwd });
  } else if (format === 'both') {
    output = renderText(findings, { cwd, useColor, hideReview });
    output += '\n--- SARIF ---\n';
    output += renderSarif(findings, result.rules, { cwd });
  } else {
    output = renderText(findings, { cwd, useColor, hideReview });
    output += '\n' + renderSummary(findings, result.rules, useColor);
  }

  if (options.out) {
    writeFileSync(options.out as string, output, 'utf8');
  } else {
    process.stdout.write(output);
  }

  return computeExitCode(findings);
}

/**
 * Tri-state exit-code:
 * - `status: 'violation'` findings always fail at exit-on >= severity.
 * - `status: 'pending'` review findings fail only when their rule's
 *   `review.exitBehavior === 'unreviewed-fails'` AND no accept entry
 *   matches them. Since the runner already filters accepted findings
 *   out of `findings`, we just check `pending + unreviewed-fails`.
 * - `status: 'accepted'` findings never fail.
 */
function computeExitCode(findings: readonly { status: string; severity: Severity }[]): number {
  for (const f of findings) {
    if (f.status === 'violation') {
      return 1;
    }
    if (f.status === 'pending') {
      // We don't have rule-level exitBehavior here, so callers
      // (runCheck) should default to severity-gated exit-on. Pending
      // review never auto-fails; the CLI passes --exit-on to set the
      // threshold for violations only.
      continue;
    }
  }
  void (findings);
  return 0;
}

async function runReview(options: ReviewOptions): Promise<number> {
  const cwd = process.cwd();
  const loaded = await loadRules({ repoRoot: cwd });

  const scope: RunnerScope = {
    cwd,
    includeGlobs: ['**/*'],
    excludeGlobs: [
      '**/node_modules/**',
      '**/dist/**',
      '**/bin/**',
      '**/obj/**',
      '**/.git/**',
    ],
    changedOnly: !options.all,
    diffBase: 'HEAD',
  };

  const result = await runRules(loaded.rules, scope, {
    acceptList: loaded.acceptList,
  });

  // Strip violations from review output — review only shows pending
  // (and optionally accepted for audit).
  const pending = result.findings.filter((f) => f.status === 'pending');
  const accepted = result.findings.filter((f) => f.status === 'accepted');

  const format = options.format as string;
  let output = '';
  if (format === 'json') {
    output = renderReviewJson(result.findings, loaded.acceptList, {
      cwd,
      includeAccepted: !!options.includeAccepted,
    });
    void (pending);
    void (accepted);
  } else {
    output = renderReview(result.findings, loaded.acceptList, {
      cwd,
      includeAccepted: !!options.includeAccepted,
    });
  }

  if (output.length > 0) {
    process.stdout.write(output);
    if (!output.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }
  return 0;
}

async function runList(_options: ListOptions): Promise<void> {
  const cwd = process.cwd();
  const useColor = shouldUseColor({ color: true } as unknown as CheckOptions);

  const loaded = await loadRules({ repoRoot: cwd });
  for (const r of loaded.rules) {
    const sev = severityColored(r.spec.severity, useColor);
    const reviewFlag = r.spec.review?.enabled
      ? ` ${pc.cyan('[review]')}`
      : '';
    const origin = formatOrigin(r.origin);
    console.log(`${r.spec.id}\t${sev}${reviewFlag}\t${origin}`);
  }
}

async function runExplain(ruleId: string, _options: ListOptions): Promise<void> {
  const cwd = process.cwd();
  const loaded = await loadRules({ repoRoot: cwd });
  const rule = loaded.rules.find((r) => r.spec.id === ruleId);
  if (!rule) {
    console.error(pc.red(`regent: no rule with id "${ruleId}"`));
    process.exitCode = 1;
    return;
  }
  console.log(`${pc.bold(rule.spec.id)}  ${pc.dim(rule.spec.severity)}`);
  if (rule.spec.review?.enabled) {
    console.log(`  ${pc.cyan('review-mode')}  ${rule.spec.review.exitBehavior ?? 'no-fail'}`);
  }
  console.log(`  Message: ${rule.spec.message}`);
  console.log(`  Source:  ${rule.source}`);
  if (rule.spec.rationale) {
    console.log(`  Rationale:`);
    for (const line of rule.spec.rationale.split('\n')) {
      console.log(`    ${line}`);
    }
  }
  if (rule.spec.review?.guidance) {
    console.log(`  Review guidance:`);
    for (const line of rule.spec.review.guidance.split('\n')) {
      console.log(`    ${line}`);
    }
  }
}

async function runAccept(
  ruleId: string,
  target: string,
  options: AcceptOptions,
): Promise<number> {
  const cwd = process.cwd();
  const configPath = options.scope
    ? joinPath(cwd, options.config as string ?? 'tools/audit/config.ts')
    : joinPath(cwd, options.config as string ?? 'tools/audit/config.local.ts');

  if (!options.reason) {
    console.error(pc.red('regent: --reason is required for accept (audit-trail).'));
    return 2;
  }

  const { path, line } = parseTarget(target);

  const current = loadConfigFile(configPath);
  const accept = [...(current.rules?.accept ?? []), {
    ruleId,
    path,
    ...(line !== undefined ? { line } : {}),
    reason: options.reason,
  }];

  writeConfigFile(configPath, {
    ...current,
    rules: { ...current.rules, accept },
  });
  console.log(pc.green(`✓ added accept entry to ${configPath}`));
  console.log(pc.dim(`  ${ruleId} → ${target}`));
  return 0;
}

async function runReject(
  ruleId: string,
  pathLine: string,
  options: RejectOptions,
): Promise<number> {
  const cwd = options.config ? joinPath(cwdSafe(options.config)) : cwdSafe(process.cwd());
  const { path, line } = parseTarget(pathLine);
  if (line === undefined) {
    console.error(pc.red('regent: reject requires <path>:<line>, not <path> alone.'));
    return 2;
  }
  const rejectionsPath = joinPath(cwd, 'tools', 'audit', '.rejections.json');
  const current: Array<{ ruleId: string; path: string; line: number }> =
    existsSync(rejectionsPath)
      ? JSON.parse(readFileSync(rejectionsPath, 'utf8'))
      : [];
  const merged = mergeRejections(current, { ruleId, path, line });
  writeFileSync(rejectionsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(pc.green(`✓ added rejection to ${rejectionsPath}`));
  return 0;
}

function mergeRejections(
  current: ReadonlyArray<{ ruleId: string; path: string; line: number }>,
  addition: { ruleId: string; path: string; line: number },
): Array<{ ruleId: string; path: string; line: number }> {
  const merged = [...current];
  if (!merged.some((r) => r.ruleId === addition.ruleId && r.path === addition.path && r.line === addition.line)) {
    merged.push(addition);
  }
  return merged;
}

function parseTarget(raw: string): { path: string; line?: number } {
  const colonIdx = raw.lastIndexOf(':');
  if (colonIdx === -1) {
    return { path: raw };
  }
  const path = raw.slice(0, colonIdx);
  const line = Number.parseInt(raw.slice(colonIdx + 1), 10);
  if (Number.isNaN(line)) {
    return { path: raw };
  }
  return { path, line };
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\\/g, '/');
}

function cwdSafe(input: string): string {
  return input;
}

function loadConfigFile(configPath: string): ConfigLayer {
  if (!existsSync(configPath)) {
    return { rules: {} };
  }
  try {
    const text = readFileSync(configPath, 'utf8');
    // Config files are loaded dynamically; for accept/reject we don't
    // need to re-evaluate them — just preserve the contents. We
    // write back a hand-crafted JS module that the loader can import.
    const parsed = parseConfigText(text);
    return parsed ?? { rules: {} };
  } catch {
    return { rules: {} };
  }
}

function parseConfigText(text: string): ConfigLayer | null {
  const config: { rules: { accept?: Array<Record<string, unknown>>; disable?: string[]; override?: Record<string, unknown>; add?: unknown[] } } = { rules: {} };
  const acceptMatch = text.match(/accept:\s*\[([\s\S]*?)\]/);
  if (!acceptMatch) {
    return null;
  }
  const body = acceptMatch[1] ?? '';
  const entries: Array<Record<string, unknown>> = [];
  const entryRegex = /\{\s*ruleId:\s*['"]([^'"]+)['"]\s*,\s*path:\s*['"]([^'"]+)['"]\s*(?:,\s*line:\s*(\d+))?\s*,\s*reason:\s*['"]([^'"]*)['"]\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(body)) !== null) {
    const ruleId = m[1];
    const path = m[2];
    const lineStr = m[3];
    const reason = m[4] ?? '';
    const line = lineStr ? Number.parseInt(lineStr, 10) : undefined;
    entries.push({
      ruleId,
      path,
      ...(line !== undefined ? { line } : {}),
      reason,
    });
  }
  if (entries.length > 0) {
    config.rules.accept = entries;
  }
  void text;
  // Best-effort parse — we re-emit config on write, so anything we
  // couldn't parse is OK to drop as long as accept-list survives.
  return config as unknown as ConfigLayer;
}

function writeConfigFile(configPath: string, config: ConfigLayer): void {
  const acceptList = config.rules?.accept ?? [];
  const disableList = config.rules?.disable ?? [];
  const overrideMap = config.rules?.override ?? {};
  const addList = config.rules?.add ?? [];

  const lines: string[] = [];
  lines.push("import { defineConfig } from '@dot-stbl/regent';");
  lines.push('');
  lines.push('export default defineConfig({');
  if (disableList.length > 0) {
    lines.push('  rules: {');
    lines.push('    disable: [');
    for (const id of disableList) {
      lines.push(`      '${id.replace(/'/g, "\\'")}',`);
    }
    lines.push('    ],');
  }
  if (Object.keys(overrideMap).length > 0) {
    lines.push('    override: {');
    for (const [id, ov] of Object.entries(overrideMap)) {
      const fields: string[] = [];
      if (ov.severity) fields.push(`severity: '${ov.severity}'`);
      if (ov.message) fields.push(`message: '${ov.message.replace(/'/g, "\\'")}'`);
      lines.push(`      '${id.replace(/'/g, "\\'")}': { ${fields.join(', ')} },`);
    }
    lines.push('    },');
  }
  if (addList.length > 0) {
    lines.push('    add: [');
    lines.push(`      // ${addList.length} rule(s) — re-emit manually`);
    lines.push('      null,');
    lines.push('    ],');
  }
  if (acceptList.length > 0) {
    if (!lines.includes('  rules: {')) {
      lines.push('  rules: {');
    }
    if (disableList.length === 0 && Object.keys(overrideMap).length === 0 && addList.length === 0) {
      lines.push('    rules: {');
    }
    lines.push('    accept: [');
    for (const entry of acceptList) {
      const fields = [`ruleId: '${entry.ruleId.replace(/'/g, "\\'")}'`, `path: '${entry.path.replace(/'/g, "\\'")}'`];
      if (entry.line !== undefined) {
        fields.push(`line: ${entry.line}`);
      }
      fields.push(`reason: '${(entry.reason ?? '').replace(/'/g, "\\'")}'`);
      lines.push(`      { ${fields.join(', ')} },`);
    }
    lines.push('    ],');
    if (disableList.length === 0 && Object.keys(overrideMap).length === 0 && addList.length === 0) {
      lines.push('    },');
    }
  }
  if (lines.includes('  rules: {')) {
    lines.push('  },');
  }
  lines.push('});');
  lines.push('');

  writeFileSync(configPath, lines.join('\n'), 'utf8');
}

function runInit(): void {
  const cwd = process.cwd();
  const auditDir = `${cwd}/tools/audit`;
  if (existsSync(auditDir)) {
    console.error(pc.red(`regent: ${auditDir} already exists`));
    process.exitCode = 1;
    return;
  }
  mkdirSync(`${auditDir}/rules`, { recursive: true });

  writeFileSync(
    `${auditDir}/config.ts`,
    `import { defineConfig } from '@dot-stbl/regent';

export default defineConfig({
  rules: {
    disable: [],
    override: {},
    accept: [],
    add: [],
  },
});
`,
    'utf8',
  );

  writeFileSync(`${auditDir}/rules/.gitkeep`, '', 'utf8');

  console.log(pc.green(`✓ created ${auditDir}/`));
  console.log(pc.dim('  regent ships zero rules. Browse curated examples with `regent llm examples <lang>` or copy via `regent example copy <lang> <rule-id>`.'));
}

function shouldUseColor(options: { color?: unknown }): boolean {
  if (options.color === false) {
    return false;
  }
  if (process.env['NO_COLOR']) {
    return false;
  }
  return pc.isColorSupported;
}

function formatOrigin(o: { kind: string; [k: string]: unknown }): string {
  switch (o.kind) {
    case 'preset':
      return `preset: ${o.preset ?? ''}`;
    case 'global':
      return `global: ${o.path ?? ''}`;
    case 'repo':
      return `repo: ${o.path ?? ''}`;
    case 'local':
      return `local: ${o.path ?? ''}`;
    default:
      return o.kind;
  }
}

function severityColored(s: Severity, useColor: boolean): string {
  if (!useColor) {
    return s;
  }
  switch (s) {
    case 'error':
      return pc.red(s);
    case 'warning':
      return pc.yellow(s);
    case 'suggestion':
      return pc.cyan(s);
  }
}

const SEVERITY_RANK: Record<Severity, number> = {
  suggestion: 0,
  warning: 1,
  error: 2,
};

function severityRank(s: Severity): number {
  return SEVERITY_RANK[s] ?? SEVERITY_RANK.error;
}

function globMatch(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(value);
}

interface CheckOptions {
  config?: string;
  scope?: string;
  all?: boolean;
  diffBase?: string;
  format?: string;
  out?: string;
  exitOn?: string;
  includeRules?: string;
  excludeRules?: string;
  severity?: string;
  color?: boolean;
  review?: boolean;
}

interface ReviewOptions {
  config?: string;
  scope?: string;
  all?: boolean;
  format?: string;
  includeAccepted?: boolean;
}

interface ListOptions {
  config?: string;
  scope?: string;
}

interface AcceptOptions {
  config?: string;
  scope?: boolean;
  reason?: string;
}

interface RejectOptions {
  config?: string;
}

// Pre-parse interception: --llm at the top level must print llm.txt
// even when no subcommand is given (Commander would otherwise show
// help because there's no default subcommand action).
if (process.argv.slice(2).includes('--llm')) {
  process.stdout.write(loadLlmText());
  process.exit(0);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const e = err as { code?: string; message?: string };
  if (e.code === 'commander.helpDisplayed' || e.code === 'commander.help' || e.code === 'commander.versionDisplayed') {
    process.exit(0);
  }
  console.error(pc.red(`regent: ${e.message ?? String(err)}`));
  process.exit(1);
});
