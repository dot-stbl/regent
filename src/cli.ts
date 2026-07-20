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
 * Output streams:
 *   - stdout: findings / reports / banners (machine-readable data)
 *   - stderr: operational logs (pino, level/format configurable)
 *
 * Log levels and format follow STBL_REGENT_LOG_LEVEL /
 * STBL_REGENT_LOG_FORMAT env vars, then --log-level / --log-format
 * CLI flags (highest precedence). Default: 'info' / 'text' (TTY) or
 * 'info' / 'json' (CI/piped).
 *
 * **Tri-state review** (default visible):
 *   - `review.enabled` rules → `status: 'pending'`, surfaced in their own
 *     section. `--no-review` hides them.
 *   - `--exit-on` only counts `status: 'violation'` and review-rule
 *     findings with `exitBehavior: 'unreviewed-fails'`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import pc from 'picocolors';

import { loadRules } from './loader.js';
import { runRules } from './runner.js';
import { renderText, renderSummary } from './reporter/text.js';
import { renderSarif } from './reporter/sarif.js';
import { renderReview, renderReviewJson } from './reporter/review.js';
import type { AcceptEntry, Finding, RunnerScope, Severity } from './types.js';
import { renderBanner } from './cli/banner.js';
import { loadLlmText } from './llm.js';
import { routeLlm } from './llm-router.js';
import { createLogger, type Logger } from './logging/index.js';
import { isLogLevel, type LogLevel } from './logging/levels.js';

const VERSION = '0.2.0';

const program = new Command();

program
  .name('regent')
  .description('Multi-mode static analysis framework for LLM agents')
  .version(VERSION)
  .option('--log-level <level>', 'log level (trace|debug|info|warn|error|fatal)')
  .option('--log-format <fmt>', 'log format (text|json)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    const envLevel = process.env['STBL_REGENT_LOG_LEVEL'];
    const envFormat = process.env['STBL_REGENT_LOG_FORMAT'];
    const levelRaw = (opts['logLevel'] as string | undefined) ?? envLevel ?? 'info';
    const formatRaw =
      (opts['logFormat'] as string | undefined) ??
      envFormat ??
      (process.stdout.isTTY ? 'text' : 'json');
    const level: LogLevel = isLogLevel(levelRaw) ? levelRaw : 'info';
    const format: 'text' | 'json' = formatRaw === 'json' ? 'json' : 'text';
    const logger = createLogger({ level, format, scope: 'cli' });
    (globalThis as { __regentLogger?: Logger }).__regentLogger = logger;
  });

program.addHelpText('beforeAll', renderBanner({ useColor: pc.isColorSupported }));

function getLogger(): Logger {
  const logger = (globalThis as { __regentLogger?: Logger }).__regentLogger;
  if (!logger) {
    return createLogger({ level: 'info', format: 'text', scope: 'cli' });
  }
  return logger;
}

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
  .command('migrate')
  .description('Migrate a legacy tools/audit/config.ts to the v0.2 .regentrc.ts format')
  .action(async () => {
    const exitCode = await runMigrate();
    process.exit(exitCode);
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
  .option('--config <path>', 'config path (default: config.local.ts; config.ts with --scope)')
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
  .command('cache')
  .description('Inspect or manage the .regent/cache.json cache')
  .argument('<action>', 'stats | clear')
  .action(async (action: string) => {
    const cwd = process.cwd();
    const { defaultCachePath } = await import('./core/cache.js');
    const cachePath = defaultCachePath(cwd);
    if (action === 'stats') {
      const { DiskCache } = await import('./core/cache.js');
      const cache = new DiskCache({ path: cachePath, maxBytes: 100 * 1024 * 1024 });
      const stats = cache.stats();
      process.stdout.write(
        `${JSON.stringify({ path: cachePath, ...stats }, null, 2)}\n`,
      );
      return;
    }
    if (action === 'clear') {
      const { existsSync, unlinkSync } = await import('node:fs');
      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
        getLogger().info({ cachePath }, 'cache cleared');
      } else {
        getLogger().info({ cachePath }, 'no cache to clear');
      }
      return;
    }
    getLogger().error({ action }, 'unknown cache action — use stats or clear');
    process.exit(2);
  });

program
  .command('example')
  .description('Browse or copy shipped examples')
  .argument('<action>', 'list | show | copy')
  .argument('[args...]', 'language or rule-id (for show/copy)')
  .action(async (action: string, args: string[]) => {
    const cwd = process.cwd();
    if (action === 'list') {
      const { examplesDir, listExamples } = await import('./examples/index.js');
      const items = listExamples(examplesDir());
      process.stdout.write(items.map((i) => `${i.language}/${i.ruleId}`).join('\n') + '\n');
      return;
    }
    if (action === 'show') {
      const [language, ruleId] = args;
      if (!language || !ruleId) {
        getLogger().error({}, 'example show <lang> <rule-id>');
        process.exit(2);
        return;
      }
      const { examplesDir, findExample } = await import('./examples/index.js');
      const found = findExample(examplesDir(), language, ruleId);
      if (!found) {
        getLogger().error({ language, ruleId }, 'example not found');
        process.exit(2);
        return;
      }
      const { readFileSync } = await import('node:fs');
      process.stdout.write(readFileSync(found, 'utf8'));
      return;
    }
    if (action === 'copy') {
      const [language, ruleId, target] = args;
      if (!language || !ruleId) {
        getLogger().error({}, 'example copy <lang> <rule-id> [target-dir]');
        process.exit(2);
        return;
      }
      const { examplesDir, findExample } = await import('./examples/index.js');
      const targetDir = target ?? `${cwd}/tools/audit/rules`;
      const { copyFileSync, mkdirSync } = await import('node:fs');
      const found = findExample(examplesDir(), language, ruleId);
      if (!found) {
        getLogger().error({ language, ruleId }, 'example not found');
        process.exit(2);
        return;
      }
      mkdirSync(targetDir, { recursive: true });
      const dest = `${targetDir}/${language}.${ruleId}.lint.ts`;
      copyFileSync(found, dest);
      process.stdout.write(`copied -> ${dest}\n`);
      return;
    }
    getLogger().error({ action }, 'unknown example action — use list/show/copy');
    process.exit(2);
  });

program
  .command('benchmark')
  .description('Run a synthetic benchmark to measure scan performance')
  .option('--files <n>', 'number of synthetic files', '100')
  .option('--rules <n>', 'number of synthetic rules', '20')
  .option('--iterations <n>', 'iterations to average', '3')
  .action(async (options) => {
    const { runBenchmark } = await import('./core/benchmark.js');
    const files = Number.parseInt(options.files as string, 10) || 100;
    const rules = Number.parseInt(options.rules as string, 10) || 20;
    const iters = Number.parseInt(options.iterations as string, 10) || 3;
    const result = await runBenchmark({ files, rules, iterations: iters });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  });

program
  .command('llm')
  .description('Print LLM-friendly skill documentation')
  .argument('[sub...]', 'subcommand path (e.g. "authoring detect", "examples csharp")')
  .action((sub: string[]) => {
    const subArgs = sub ?? [];
    const result = routeLlm(subArgs);
    if (result.kind === 'ok') {
      process.stdout.write(result.content);
      process.exit(0);
    }
    getLogger().error({}, result.message);
    process.exit(2);
  });

async function runCheck(options: CheckOptions): Promise<number> {
  const cwd = process.cwd();
  const useColor = shouldUseColor(options);
  const hideReview = options.review === false;

  let loadedRules;
  try {
    loadedRules = await loadRules({ repoRoot: cwd });
  } catch (err) {
    getLogger().error({ err: { message: (err as Error).message } }, 'failed to load rules');
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

  const result = await runRules(rules, scope, {
    acceptList: loadedRules.acceptList,
    contextBuffer: loadedRules.resolvedConfig.output.contextBuffer,
  });
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

  // Exit code is computed on the FULL finding set (result.findings), not
  // the display-filtered `findings` — `--severity` / `--no-review` change
  // what is printed, never the exit code.
  return computeExitCode(result.findings, (options.exitOn as Severity) ?? 'error');
}

/**
 * Tri-state exit-code, gated by the `--exit-on` severity threshold:
 * - `status: 'violation'` fails when its severity >= `exitOn`.
 * - `status: 'pending'` review findings fail only when the rule is
 *   `review.exitBehavior === 'unreviewed-fails'` AND severity >= `exitOn`
 *   (accepted findings are already filtered out by the runner).
 * - `status: 'accepted'` never fails.
 */
function computeExitCode(findings: readonly Finding[], exitOn: Severity): number {
  const threshold = severityRank(exitOn);
  for (const f of findings) {
    if (severityRank(f.severity) < threshold) {
      continue;
    }
    if (f.status === 'violation') {
      return 1;
    }
    if (f.status === 'pending' && f.review?.exitBehavior === 'unreviewed-fails') {
      return 1;
    }
  }
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
    contextBuffer: loaded.resolvedConfig.output.contextBuffer,
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
    getLogger().error({ ruleId }, 'rule not found');
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
  // `--config` overrides the target; otherwise `--scope` selects the
  // committed config.ts, and the default is the gitignored config.local.ts.
  const configPath = joinPath(
    cwd,
    options.config ?? (options.scope ? 'tools/audit/config.ts' : 'tools/audit/config.local.ts'),
  );

  if (!options.reason) {
    getLogger().error({}, '--reason is required for accept (audit-trail)');
    return 2;
  }

  const { path, line } = parseTarget(target);
  const entry: AcceptEntry = {
    ruleId,
    path,
    ...(line !== undefined ? { line } : {}),
    reason: options.reason,
  };

  try {
    upsertAcceptEntry(configPath, entry);
  } catch (err) {
    getLogger().error({ err: { message: (err as Error).message } }, 'failed to write accept entry');
    return 1;
  }

  console.log(pc.green(`✓ added accept entry to ${configPath}`));
  console.log(pc.dim(`  ${ruleId} → ${target}`));
  return 0;
}

async function runReject(
  ruleId: string,
  pathLine: string,
  options: RejectOptions,
): Promise<number> {
  const repoRoot = options.config ?? '.';
  const { path, line } = parseTarget(pathLine);
  if (line === undefined) {
    getLogger().error({}, 'reject requires <path>:<line>, not <path> alone');
    return 2;
  }
  const rejectionsPath = joinPath(repoRoot, 'tools', 'audit', '.rejections.json');
  mkdirSync(dirname(rejectionsPath), { recursive: true });
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

/**
 * Serialize an accept entry as a single-quoted, escaped TS object literal
 * for insertion into a config's `accept: [ ... ]` array.
 */
function serializeAcceptEntry(entry: AcceptEntry): string {
  const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const fields = [`ruleId: ${q(entry.ruleId)}`, `path: ${q(entry.path)}`];
  if (entry.line !== undefined) {
    fields.push(`line: ${entry.line}`);
  }
  fields.push(`reason: ${q(entry.reason ?? '')}`);
  return `{ ${fields.join(', ')} }`;
}

/**
 * Add an accept entry to a config file WITHOUT rewriting the rest of it.
 *
 * The previous implementation regex-scraped only the `accept` array and
 * re-emitted the whole module, silently dropping `detect`/`disable`/
 * `override`/`add`. This splices the entry into the existing
 * `accept: [ ... ]` (or creates the minimal nesting) and leaves every
 * other section byte-for-byte intact.
 */
function upsertAcceptEntry(configPath: string, entry: AcceptEntry): void {
  const serialized = serializeAcceptEntry(entry);

  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, scaffoldConfigWithAccept(serialized), 'utf8');
    return;
  }

  const text = readFileSync(configPath, 'utf8');

  // 1. An `accept: [` array already exists → insert right after `[`.
  if (/accept\s*:\s*\[/.test(text)) {
    writeFileSync(
      configPath,
      text.replace(/accept\s*:\s*\[/, (m) => `${m}\n      ${serialized},`),
      'utf8',
    );
    return;
  }

  // 2. A `rules: {` block exists → give it an `accept` array.
  if (/rules\s*:\s*\{/.test(text)) {
    writeFileSync(
      configPath,
      text.replace(/rules\s*:\s*\{/, (m) => `${m}\n    accept: [\n      ${serialized},\n    ],`),
      'utf8',
    );
    return;
  }

  // 3. A bare `defineConfig({` → add the whole `rules.accept` nesting.
  if (/defineConfig\s*\(\s*\{/.test(text)) {
    writeFileSync(
      configPath,
      text.replace(/defineConfig\s*\(\s*\{/, (m) => `${m}\n  rules: {\n    accept: [\n      ${serialized},\n    ],\n  },`),
      'utf8',
    );
    return;
  }

  // 4. Unrecognized shape → refuse rather than clobber.
  throw new Error(
    `could not find a defineConfig/rules block in ${configPath}; add the entry manually: ${serialized}`,
  );
}

function scaffoldConfigWithAccept(serializedEntry: string): string {
  return [
    "import { defineConfig } from '@dot-stbl/regent';",
    '',
    'export default defineConfig({',
    '  rules: {',
    '    accept: [',
    `      ${serializedEntry},`,
    '    ],',
    '  },',
    '});',
    '',
  ].join('\n');
}

function runInit(): void {
  const cwd = process.cwd();
  const auditDir = `${cwd}/tools/audit`;
  if (existsSync(auditDir)) {
    getLogger().error({ auditDir }, 'init refused — directory already exists');
    process.exitCode = 1;
    return;
  }
  mkdirSync(`${auditDir}/rules`, { recursive: true });

  // v0.2 scaffold: tools/audit/ kept for back-compat but a .regentrc.*
  // is the recommended location. The init writes a stub config that
  // documents the new layout — agent/developer fills it in via
  // `regent example copy <lang> <rule-id>` or by editing the file
  // directly.
  writeFileSync(
    `${auditDir}/config.ts`,
    `import { defineConfig } from '@dot-stbl/regent';

// regent ships zero rules. Browse curated examples:
//   $ regent llm examples <lang>
// Or copy one into ./rules/:
//   $ regent example copy csharp no-todo-without-owner
//   $ regent example copy typescript no-console
//   $ regent example copy meta trailing-newline
//
// Inline rules can also live in this file under rules.detect[]:
//   rules: { detect: [{ id: 'foo', severity: 'error', pattern: '...', globs: ['**/*'], message: '...' }] }
//
// Use excludePaths / excludeGroups to scope rule coverage:
//   excludePaths: ['@generated', '@node-modules']
//   excludeGroups: { 'contract-tests': ['**/ContractTests/**'] }
export default defineConfig({
  rules: {
    detect: [],
    fix: [],
    extends: [],
    disable: [],
    override: {},
    accept: [],
  },
});
`,
    'utf8',
  );

  // .gitignore: config.local.ts (per-dev overrides), .rejections.json
  writeFileSync(
    `${auditDir}/.gitignore`,
    `config.local.ts
.rejections.json
`,
    'utf8',
  );

  // AGENT.md — instruction for an LLM agent running in this repo.
  writeFileSync(
    `${auditDir}/AGENT.md`,
    `# rules for this folder

regent is a multi-mode static analysis framework. Three rule kinds:

- \`*.lint.ts\` — detect-only (eslint-style)
- \`*.fix.ts\` — match + replace (prettier-lite)
- \`*.transform.ts\` — programmatic rewrite (v0.3+)

## how to author

1. \`regent llm authoring detect\` — full guide
2. \`regent llm schema detect\` — spec schema
3. \`regent llm examples <lang>\` — curated examples
4. \`regent example copy <lang> <rule-id>\` — copy an example into here

## how to verify

\`regent check\` runs all rules. Iterate until clean.
\`regent fix\` applies auto-fixes (writes files).
\`regent review\` surfaces tri-state review candidates.
`,
    'utf8',
  );

  writeFileSync(`${auditDir}/rules/.gitkeep`, '', 'utf8');

  process.stdout.write(`✓ created ${auditDir}/\n`);
  process.stdout.write(`  regent ships zero rules. Browse curated examples with \`regent llm examples <lang>\` or copy via \`regent example copy <lang> <rule-id>\`.\n`);
  process.stdout.write(`  Next: see ${auditDir}/AGENT.md for an agent's-eye view.\n`);
}

async function runMigrate(): Promise<number> {
  const cwd = process.cwd();
  // Accept either .ts or .js legacy config — both have shipped.
  let legacyPath = '';
  for (const ext of ['.ts', '.mts', '.js', '.mjs']) {
    const candidate = `${cwd}/tools/audit/config${ext}`;
    if (existsSync(candidate)) {
      legacyPath = candidate;
      break;
    }
  }
  if (!legacyPath) {
    process.stdout.write('no legacy tools/audit/config.{ts,js} to migrate\n');
    return 0;
  }
  // Minimal v0.2 migration — reads the legacy config and emits a
  // .regentrc.ts. The legacy shape used rules.add[]; v0.2 uses
  // rules.detect[] / rules.fix[]. We split based on which fields are
  // present (rules with `find` are fix rules; everything else is a
  // detect rule).
  try {
    const mod = (await import(pathToFileURL(legacyPath).href)) as {
      default?: { rules?: { add?: Array<Record<string, unknown>> } };
    };
    const add = mod.default?.rules?.add ?? [];
    const detect = add.filter((r) => !('find' in r));
    const fix = add.filter((r) => 'find' in r);
    const config = {
      rules: {
        detect,
        fix,
        extends: [],
        disable: [],
        override: {},
        accept: [],
      },
    };
    const targetPath = `${cwd}/.regentrc.ts`;
    const banner = `// migrated from tools/audit/config.ts on ${new Date().toISOString()}\n// source: ${legacyPath}\n\n`;
    writeFileSync(
      targetPath,
      banner + `import { defineConfig } from '@dot-stbl/regent';\n\nexport default defineConfig(${JSON.stringify(config, null, 2)});\n`,
      'utf8',
    );
    process.stdout.write(`✓ migrated -> ${targetPath}\n`);
    process.stdout.write(`  ${detect.length} detect rule(s), ${fix.length} fix rule(s)\n`);
    process.stdout.write(`  Original at ${legacyPath} — back up and delete when ready.\n`);
    return 0;
  } catch (err) {
    getLogger().error({ err: { message: (err as Error).message } }, 'migrate failed');
    return 1;
  }
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
  getLogger().error({ err: { message: e.message ?? String(err) } }, 'cli fatal');
  process.exit(1);
});
