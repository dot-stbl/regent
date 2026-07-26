/**
 * `regent mcp serve` — Model Context Protocol integration over stdio.
 *
 * Hand-rolled JSON-RPC server that exposes regent's loader / runner
 * / fixer as MCP tools. v1 ships six tools, all read-only:
 *
 *   - regent.list_rules       — discover loaded rules
 *   - regent.check            — run a scan, return structured findings
 *   - regent.explain_rule     — rule id → spec + rationale + remediation
 *   - regent.explain_finding  — file:line:col → rule + matched code
 *   - regent.suggest_fix      — dry-run fix proposal (no writes)
 *   - regent.status           — health summary (mirrors regent doctor)
 *
 * Design rationale:
 *   - No SDK dep — `@modelcontextprotocol/sdk@1.29.0` is 4.27 MB
 *     unpacked; stdio wire is six methods, ~140 LOC.
 *   - Each tool's input is validated with Zod; tool-level errors
 *     (unknown rule, no finding at locator, …) are returned as
 *     `isError: true` structured responses — JSON-RPC -32602 is
 *     reserved for malformed params / protocol violations.
 *   - Suggest_fix runs the per-file detector (not the whole tree)
 *     to find the finding, then runs the fixer engine in dry-run
 *     mode against the one-file finding set.
 *
 * Refs: PR #132 (prototype + design), .planning/2026-07-25-mcp-design.md
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simpleGit } from 'simple-git';
import { z } from 'zod';
import type { Command } from 'commander';

import { applyFixes, type ApplyFixesResult } from '../fixer.js';
import { loadRules, type LoaderRuleSet } from '../loader.js';
import { detectFile, runRules } from '../runner.js';
import type { Finding, Match, RuleSpec } from '../types.js';
import { runExplain } from './explain.js';
import { runDoctorReport } from './doctor.js';
import { runDelegates } from '../runner/delegate.js';

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

type RpcId = string | number | null;

interface RpcRequest {
  readonly jsonrpc?: string;
  readonly id?: RpcId;
  readonly method?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

interface RpcNotification {
  readonly jsonrpc?: string;
  readonly method?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

const PROTOCOL_VERSION = '2025-11-25';
const SERVER_INFO = {
  name: 'regent',
  // Tracks the package.json — bumped automatically on release.
  version: readServerVersion(),
};

/** Read the server version from package.json. Falls back to the
 *  prototype marker if package.json is missing (e.g. running from
 *  a built dist/ where the relative path differs). */
function readServerVersion(): string {
  try {
    // dist/cli/mcp.js → ../../package.json (3 levels up from `dist/cli/`)
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, '..', '..', 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
      if (typeof pkg.version === 'string') return pkg.version;
    }
  } catch {
    // ignore — fall through
  }
  return '0.0.0-unknown';
}

function respond(id: RpcId, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function protocolError(id: RpcId, code: number, message: string): void {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`,
  );
}

// ---------------------------------------------------------------------------
// Tool schemas (Zod)
// ---------------------------------------------------------------------------

const EmptyObject = z.object({}).strict();

const CheckInput = z.object({
  cwd: z.string().optional(),
  all: z.boolean().optional(),
  severity: z.string().optional(),
  includeRules: z.array(z.string()).optional(),
  excludeRules: z.array(z.string()).optional(),
}).strict();

const ExplainRuleInput = z.object({
  ruleId: z.string().min(1),
}).strict();

const ExplainFindingInput = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
}).strict();

const SuggestFixInput = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  unsafe: z.boolean().optional(),
}).strict();

const StatusInput = z.object({
  cwd: z.string().optional(),
  network: z.boolean().optional(),
}).strict();

// ---------------------------------------------------------------------------
// Tool catalogue
// ---------------------------------------------------------------------------

interface ToolDef {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
  };
  readonly handler: (params: unknown) => Promise<unknown>;
}

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

const TOOLS: readonly ToolDef[] = [
  {
    name: 'regent.list_rules',
    title: 'List Regent Rules',
    description: 'List the rules loaded for the current repository.',
    inputSchema: jsonSchemaFor(EmptyObject),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: () => toolListRules(),
  },
  {
    name: 'regent.check',
    title: 'Run a Regent Scan',
    description:
      'Run a scan against the cwd and return structured findings (no text rendering). '
      + 'Mirrors `regent check`; options are a subset of the CLI flags.',
    inputSchema: jsonSchemaFor(CheckInput),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    handler: (params) => toolCheck(CheckInput.parse(params)),
  },
  {
    name: 'regent.explain_rule',
    title: 'Explain a Rule',
    description:
      'For a rule id, return description, rationale, review guidance, source path, '
      + 'and the rule spec.',
    inputSchema: jsonSchemaFor(ExplainRuleInput),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: (params) => toolExplainRule(ExplainRuleInput.parse(params)),
  },
  {
    name: 'regent.explain_finding',
    title: 'Explain a Finding',
    description:
      'For a finding at file:line:col, return the matched code window, the rule that '
      + 'fired, the suggested remediation, and the suppression command.',
    inputSchema: jsonSchemaFor(ExplainFindingInput),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: (params) => toolExplainFinding(ExplainFindingInput.parse(params)),
  },
  {
    name: 'regent.suggest_fix',
    title: 'Suggest a Fix (Dry-Run)',
    description:
      'Given a finding at file:line:col, run the fixer engine in dry-run mode and '
      + 'return the proposed edits without writing to disk. unsafe=true includes '
      + 'function-kind and safety=suggested fixes (mirrors `regent fix --unsafe --dry-run`).',
    inputSchema: jsonSchemaFor(SuggestFixInput),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: (params) => toolSuggestFix(SuggestFixInput.parse(params)),
  },
  {
    name: 'regent.status',
    title: 'Regent Status',
    description:
      'Health summary — version, cwd, git status, rule counts by kind, '
      + 'and the optional doctor checklist (network probe is opt-in).',
    inputSchema: jsonSchemaFor(StatusInput),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    handler: (params) => toolStatus(StatusInput.parse(params)),
  },
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

interface RuleSummary {
  readonly id: string;
  readonly severity: string;
  readonly kind: 'detect' | 'ast' | 'transform';
  readonly source: string;
}

function summarizeLoader(loaded: LoaderRuleSet): readonly RuleSummary[] {
  const out: RuleSummary[] = [];
  for (const r of loaded.rules) {
    out.push({ id: r.spec.id, severity: r.spec.severity, kind: 'detect', source: r.source });
  }
  for (const r of loaded.astRules) {
    out.push({ id: r.spec.id, severity: r.spec.severity, kind: 'ast', source: r.source });
  }
  for (const r of loaded.transformRules) {
    out.push({ id: r.spec.id, severity: r.spec.severity, kind: 'transform', source: r.source });
  }
  return out;
}

async function toolListRules(): Promise<Record<string, unknown>> {
  const cwd = process.cwd();
  const loaded = await loadRules({ repoRoot: cwd });
  const rules = summarizeLoader(loaded);
  return {
    rules,
    total: rules.length,
    cwd,
    kinds: {
      detect: loaded.rules.length,
      ast: loaded.astRules.length,
      transform: loaded.transformRules.length,
      format: loaded.formatSpecs.length,
      delegate: loaded.delegateSpecs.length,
    },
  };
}

async function toolCheck(
  input: z.infer<typeof CheckInput>,
): Promise<Record<string, unknown>> {
  const cwd = input.cwd ?? process.cwd();
  let loaded: LoaderRuleSet;
  try {
    loaded = await loadRules({ repoRoot: cwd });
  } catch (err) {
    return toolError(`failed to load rules: ${(err as Error).message}`);
  }

  let rules = loaded.rules;
  let astRules = loaded.astRules;
  if (input.includeRules && input.includeRules.length > 0) {
    const patterns = input.includeRules;
    rules = rules.filter((r) => patterns.some((p) => matchGlob(r.spec.id, p)));
    astRules = astRules.filter((r) => patterns.some((p) => matchGlob(r.spec.id, p)));
  }
  if (input.excludeRules && input.excludeRules.length > 0) {
    const ids = new Set(input.excludeRules);
    rules = rules.filter((r) => !ids.has(r.spec.id));
    astRules = astRules.filter((r) => !ids.has(r.spec.id));
  }

  const scope = {
    cwd,
    includeGlobs: ['**/*'],
    excludeGlobs: [
      '**/node_modules/**',
      '**/dist/**',
      '**/bin/**',
      '**/obj/**',
      '**/.git/**',
    ],
    changedOnly: input.all !== true,
    diffBase: 'HEAD',
  };

  let result: Awaited<ReturnType<typeof runRules>>;
  try {
    result = await runRules(rules, scope, {
      acceptList: loaded.acceptList,
      contextBuffer: loaded.resolvedConfig.output.contextBuffer,
      concurrency: loaded.resolvedConfig.runner.concurrency,
      astRules,
    });
  } catch (err) {
    return toolError(`scan failed: ${(err as Error).message}`);
  }

  let findings = [...result.findings];
  // Workspace-level delegate specs (per `regent check`).
  try {
    const delegateFindings = await runDelegates(
      loaded.delegateSpecs,
      loaded.resolvedConfig.rules.configure,
    );
    findings = [...findings, ...delegateFindings];
  } catch (err) {
    // Delegate failures should not fail the whole check.
    process.stderr.write(`regent mcp: delegate run failed: ${(err as Error).message}\n`);
  }

  if (input.severity) {
    const min = severityRank(input.severity);
    if (min !== null) {
      const minRank = min;
      findings = findings.filter((f) => {
        const rank = severityRank(f.severity);
        return rank !== null && rank >= minRank;
      });
    }
  }

  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
  }

  return {
    findings: findings.map(serializeFinding),
    scannedFiles: result.scannedFiles,
    summary: { bySeverity, byStatus },
    cwd,
  };
}

async function toolExplainRule(
  input: z.infer<typeof ExplainRuleInput>,
): Promise<Record<string, unknown>> {
  const cwd = process.cwd();
  // `runExplain` writes to process.stdout — capture it instead.
  const captured = await captureStdout(async () => {
    return runExplain(input.ruleId, { cwd, format: 'json' });
  });
  if (captured.exitCode !== 0) {
    return toolError(
      captured.stderr || `no rule with id '${input.ruleId}'; run regent.list_rules for the full list`,
    );
  }
  const trimmed = captured.stdout.trim();
  if (trimmed === '') {
    return toolError(`empty explanation for rule '${input.ruleId}'`);
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return toolError(`explanation for rule '${input.ruleId}' was not valid JSON`);
  }
}

async function toolExplainFinding(
  input: z.infer<typeof ExplainFindingInput>,
): Promise<Record<string, unknown>> {
  const cwd = process.cwd();
  const locator = `${input.file}:${String(input.line)}:${String(input.column)}`;
  const captured = await captureStdout(async () => {
    return runExplain(locator, { cwd, format: 'json' });
  });
  if (captured.exitCode !== 0) {
    return toolError(captured.stderr || `no finding at ${locator}; run regent.check to refresh`);
  }
  const trimmed = captured.stdout.trim();
  if (trimmed === '') {
    return toolError(`empty explanation for finding at ${locator}`);
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return toolError(`explanation for finding at ${locator} was not valid JSON`);
  }
}

async function toolSuggestFix(
  input: z.infer<typeof SuggestFixInput>,
): Promise<Record<string, unknown>> {
  const cwd = process.cwd();
  const file = isAbsolute(input.file) ? input.file : resolve(cwd, input.file);
  if (!existsSync(file)) {
    return toolError(`file not found: ${input.file}`);
  }

  let loaded: LoaderRuleSet;
  try {
    loaded = await loadRules({ repoRoot: cwd });
  } catch (err) {
    return toolError(`failed to load rules: ${(err as Error).message}`);
  }

  // Find the finding at (file, line, col) — use detectFile so we
  // don't re-scan the whole tree for one finding.
  let findings: readonly Finding[];
  try {
    findings = await detectFile(file, loaded.rules, {
      acceptList: loaded.acceptList,
      astRules: loaded.astRules,
      contextBuffer: 3,
    });
  } catch (err) {
    return toolError(`detect failed: ${(err as Error).message}`);
  }
  const target = findings.find((f) =>
    f.match.startLine + 1 === input.line
    && f.match.startColumn + 1 === input.column,
  );
  if (target === undefined) {
    return toolError(
      `no finding at ${input.file}:${String(input.line)}:${String(input.column)}; run regent.check to refresh`,
    );
  }

  const rulesById = new Map<string, RuleSpec>();
  for (const r of loaded.rules) rulesById.set(r.spec.id, r.spec);

  let fixResult: ApplyFixesResult;
  try {
    fixResult = await applyFixes(
      [target],
      rulesById,
      {
        cwd,
        dryRun: true,
        lane: input.unsafe === true ? 'all' : 'safe',
        acceptList: loaded.acceptList,
        contextBuffer: loaded.resolvedConfig.output.contextBuffer,
      },
    );
  } catch (err) {
    return toolError(`fix engine failed: ${(err as Error).message}`);
  }

  const edits = [
    ...fixResult.applied.map((e) => ({
      kind: 'applied' as const,
      ruleId: e.ruleId,
      file: e.file,
      range: e.range,
      before: e.before,
      after: e.after,
      title: e.title,
    })),
    ...fixResult.suggested.map((e) => ({
      kind: 'suggested' as const,
      ruleId: e.ruleId,
      file: e.file,
      range: e.range,
      title: e.title,
      guidance: e.guidance,
      proposedEdit: e.proposedEdit,
    })),
    ...fixResult.deferred.map((d) => ({
      kind: 'deferred' as const,
      ruleId: d.ruleId,
      file: d.file,
      range: d.range,
      reason: d.reason,
      ...(d.winningRuleId !== undefined ? { winningRuleId: d.winningRuleId } : {}),
      ...(d.title !== undefined ? { title: d.title } : {}),
    })),
  ];

  const confidence: 'high' | 'medium' | 'low' =
    fixResult.applied.length > 0 ? 'high'
      : fixResult.suggested.length > 0 ? 'medium'
      : 'low';

  return {
    target: { file: input.file, line: input.line, column: input.column },
    finding: serializeFinding(target),
    edits,
    confidence,
    passes: fixResult.passes,
    dryRun: true,
  };
}

async function toolStatus(
  input: z.infer<typeof StatusInput>,
): Promise<Record<string, unknown>> {
  const cwd = input.cwd ?? process.cwd();

  let loaded: LoaderRuleSet;
  try {
    loaded = await loadRules({ repoRoot: cwd });
  } catch (err) {
    return toolError(`failed to load rules: ${(err as Error).message}`);
  }

  const git = await safeGitStatus(cwd);
  const cachePath = resolve(cwd, '.regent', 'cache.json');
  const cache = safeCacheStat(cachePath);

  // The doctor report is the underlying health-check — surface it
  // as the `health` field for callers that want a per-check breakdown
  // without re-running the full regent doctor.
  const runHealth = input.network !== false;
  let health: unknown = undefined;
  if (runHealth) {
    try {
      health = await runDoctorReport({ cwd, network: true });
    } catch (err) {
      process.stderr.write(`regent mcp: doctor report failed: ${(err as Error).message}\n`);
    }
  }

  return {
    version: SERVER_INFO.version,
    protocolVersion: PROTOCOL_VERSION,
    cwd,
    git,
    rules: {
      detect: loaded.rules.length,
      ast: loaded.astRules.length,
      transform: loaded.transformRules.length,
      format: loaded.formatSpecs.length,
      delegate: loaded.delegateSpecs.length,
    },
    cache: cache ?? null,
    ...(health !== undefined ? { health } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolError(message: string): Record<string, unknown> {
  return { error: message, isError: true };
}

interface CapturedIO {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Capture process.stdout/stderr while a callback runs, restore on
 *  exit (success or failure). The CLI helpers `runExplain` /
 *  `runCheck` write directly to stdout — this lets MCP callers see
 *  their output as a string instead of having it leak to the pipe. */
async function captureStdout(
  fn: () => Promise<number>,
): Promise<CapturedIO> {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown, ..._rest: unknown[]): boolean => {
    out.push(Buffer.from(typeof chunk === 'string' ? chunk : String(chunk)));
    return true;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown, ..._rest: unknown[]): boolean => {
    err.push(Buffer.from(typeof chunk === 'string' ? chunk : String(chunk)));
    return true;
  };
  let exitCode = 1;
  try {
    exitCode = await fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return {
    stdout: Buffer.concat(out).toString('utf8'),
    stderr: Buffer.concat(err).toString('utf8'),
    exitCode,
  };
}

function serializeFinding(f: Finding): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ruleId: f.ruleId,
    severity: f.severity,
    status: f.status,
    path: f.path,
    match: serializeMatch(f.match),
    context: {
      startLine: f.context.startLine + 1,
      endLine: f.context.endLine + 1,
      lines: [...f.context.lines],
    },
    message: f.message,
    source: f.source,
  };
  if (f.rationale !== undefined) out['rationale'] = f.rationale;
  if (f.review !== undefined) out['review'] = f.review;
  if (f.acceptedReason !== undefined) out['acceptedReason'] = f.acceptedReason;
  return out;
}

function serializeMatch(m: Match): Record<string, unknown> {
  const out: Record<string, unknown> = {
    startLine: m.startLine + 1,
    startColumn: m.startColumn + 1,
    endLine: m.endLine + 1,
    endColumn: m.endColumn + 1,
    matchText: m.matchText,
  };
  if (m.groups !== undefined) out['groups'] = [...m.groups];
  return out;
}

async function safeGitStatus(cwd: string): Promise<Record<string, unknown>> {
  try {
    const git = simpleGit({ baseDir: cwd });
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return { branch: null, dirty: false, ahead: 0, isRepo: false };
    }
    const status = await git.status();
    const branch =
      typeof status.current === 'string' && status.current.length > 0
        ? status.current
        : null;
    const ahead = status.ahead ?? 0;
    const dirty =
      status.modified.length > 0
      || status.not_added.length > 0
      || status.created.length > 0
      || status.deleted.length > 0
      || status.renamed.length > 0
      || status.conflicted.length > 0;
    return { branch, dirty, ahead, isRepo: true };
  } catch {
    return { branch: null, dirty: false, ahead: 0, isRepo: false };
  }
}

function safeCacheStat(
  cachePath: string,
): { readonly path: string; readonly sizeBytes: number; readonly mtimeMs: number } | null {
  try {
    if (!existsSync(cachePath)) return null;
    const st = statSync(cachePath);
    return { path: cachePath, sizeBytes: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

const SEVERITY_ORDER: readonly string[] = ['info', 'warning', 'error'];

function severityRank(severity: string): number | null {
  const idx = SEVERITY_ORDER.indexOf(severity);
  return idx === -1 ? null : idx;
}

/** `**` → `.*`, `*` → `[^/]*`, `?` → `[^/]` — same glob semantics
 *  as `regent check --include-rules` / `--exclude-rules` on the CLI. */
function matchGlob(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DBL_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DBL_STAR__/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`).test(value);
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

async function handleRequest(request: RpcRequest): Promise<void> {
  const id = request.id ?? null;
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    protocolError(id, -32600, 'Invalid Request');
    return;
  }

  if (request.method === 'initialize') {
    respond(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
    return;
  }

  if (request.method === 'ping') {
    respond(id, {});
    return;
  }

  if (request.method === 'tools/list') {
    respond(id, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      })),
    });
    return;
  }

  if (request.method === 'tools/call') {
    const params = request.params ?? {};
    const name = params['name'];
    if (typeof name !== 'string') {
      protocolError(id, -32602, `tools/call requires params.name (string)`);
      return;
    }
    const tool = TOOLS.find((t) => t.name === name);
    if (tool === undefined) {
      protocolError(id, -32602, `unknown tool: ${name}`);
      return;
    }
    const args = params['arguments'] ?? {};
    let result: unknown;
    try {
      result = await tool.handler(args);
    } catch (err) {
      // ZodError → invalid params (JSON-RPC -32602). Anything else
      // is an internal error → -32603.
      if (err instanceof z.ZodError) {
        protocolError(id, -32602, `invalid params for ${name}: ${err.message}`);
        return;
      }
      protocolError(id, -32603, `${name} failed: ${(err as Error).message}`);
      return;
    }
    // If the handler returned an isError-shaped object, surface it
    // as MCP `isError: true` so the client distinguishes protocol
    // errors from tool-level failures.
    const isToolError = isErrorResult(result);
    respond(id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      ...(isToolError ? { isError: true } : {}),
    });
    return;
  }

  protocolError(id, -32601, `Method not found: ${request.method}`);
}

function isErrorResult(result: unknown): boolean {
  return (
    typeof result === 'object'
    && result !== null
    && (result as { readonly isError?: unknown }).isError === true
  );
}

function isNotification(message: RpcRequest | RpcNotification): boolean {
  return (message as { readonly id?: unknown }).id === undefined;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Start the stdio MCP server. Reads JSON-RPC lines from stdin until
 *  EOF, writes responses to stdout. Never throws — uncaught errors
 *  become JSON-RPC -32603. */
export async function runMcpServer(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let parsed: RpcRequest | RpcNotification;
    try {
      parsed = JSON.parse(line) as RpcRequest | RpcNotification;
    } catch (err) {
      protocolError(null, -32700, `Parse error: ${(err as Error).message}`);
      continue;
    }
    if (isNotification(parsed)) {
      // `notifications/initialized`, `notifications/cancelled`, …
      // — accepted, no reply.
      continue;
    }
    const req = parsed as RpcRequest;
    try {
      await handleRequest(req);
    } catch (err) {
      protocolError(req.id ?? null, -32603, (err as Error).message);
    }
  }
}

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Model Context Protocol integration (stdio JSON-RPC)')
    .command('serve')
    .description('Serve the MCP tool surface over stdio')
    .action(runMcpServer);
}