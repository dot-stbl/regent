import { createInterface } from 'node:readline';
import type { Command } from 'commander';

import { loadRules } from '../loader.js';

type RpcId = string | number | null;
interface RpcRequest {
  readonly jsonrpc?: string;
  readonly id?: RpcId;
  readonly method?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

const protocolVersion = '2025-11-25';
const listRulesTool = {
  name: 'regent.list_rules',
  title: 'List Regent Rules',
  description: 'List the rules loaded for the current repository.',
  inputSchema: { type: 'object', additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
};

function respond(id: RpcId, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function fail(id: RpcId, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

async function listRules(): Promise<Record<string, unknown>> {
  const loaded = await loadRules({ repoRoot: process.cwd() });
  const rules = [
    ...loaded.rules.map((rule) => ({
      id: rule.spec.id, severity: rule.spec.severity, kind: 'detect', source: rule.source,
    })),
    ...loaded.astRules.map((rule) => ({
      id: rule.spec.id, severity: rule.spec.severity, kind: 'ast', source: rule.source,
    })),
    ...loaded.transformRules.map((rule) => ({
      id: rule.spec.id, severity: rule.spec.severity, kind: 'transform', source: rule.source,
    })),
  ];
  return { rules, total: rules.length };
}

async function handle(request: RpcRequest): Promise<void> {
  const id = request.id ?? null;
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    fail(id, -32600, 'Invalid Request');
    return;
  }
  if (request.method === 'initialize') {
    respond(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'regent', version: '0.1.0-prototype' },
    });
    return;
  }
  if (request.method === 'ping') {
    respond(id, {});
    return;
  }
  if (request.method === 'tools/list') {
    respond(id, { tools: [listRulesTool] });
    return;
  }
  if (request.method === 'tools/call') {
    if (request.params?.['name'] !== listRulesTool.name) {
      fail(id, -32602, `Unknown tool: ${String(request.params?.['name'])}`);
      return;
    }
    const result = await listRules();
    respond(id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    });
    return;
  }
  fail(id, -32601, 'Method not found');
}

export async function runMcpServer(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    try {
      const request = JSON.parse(line) as RpcRequest;
      if (request.id !== undefined) await handle(request);
    } catch (error) {
      fail(null, -32603, error instanceof Error ? error.message : 'Internal error');
    }
  }
}

export function registerMcpCommand(program: Command): void {
  program.command('mcp').description('Model Context Protocol integration')
    .command('serve').description('Serve MCP over stdio')
    .action(runMcpServer);
}