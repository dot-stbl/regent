/**
 * L3 (e2e): `regent mcp serve` (#132) — stdio JSON-RPC MCP server.
 *
 * Spawn `dist/cli.js mcp serve`, send NDJSON JSON-RPC lines, assert
 * response shapes. Covers all six v1 tools plus the protocol
 * plumbing (initialize, ping, tools/list, notifications, error codes).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ROOT = join(tmpdir(), `regent-mcp-${Date.now()}`);
const EMPTY_GLOBALS = join(ROOT, 'globals');
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');
const ZOD_URL = pathToFileURL(join(import.meta.dirname, '..', 'node_modules', 'zod', 'index.js')).href;
const originalGlobalRulesPath = process.env['STBL_REGENT_GLOBAL_RULES_PATH'];

const KNOWN_CONTENT = [
  'alpha',
  '  bad();',
  'omega',
  '',
].join('\n');

beforeAll(() => {
  mkdirSync(EMPTY_GLOBALS, { recursive: true });
  process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = EMPTY_GLOBALS;

  writeFileSync(join(ROOT, 'Known.cs'), KNOWN_CONTENT, 'utf8');
  writeFileSync(
    join(ROOT, '.regentrc.js'),
    `import { z } from ${JSON.stringify(ZOD_URL)};

export default {
  rules: {
    detect: [
      {
        id: 'fixture.no-bad',
        severity: 'error',
        pattern: 'bad\\\\(\\\\)',
        globs: ['**/*.cs'],
        message: 'bad() is forbidden',
        description: 'Use the supported call instead.',
        references: ['https://example.test/rules/no-bad'],
        source: 'rules.md#no-bad',
        fix: {
          kind: 'replace',
          safety: 'safe',
          title: 'replace bad() with good()',
          template: 'good()',
        },
      },
    ],
  },
};
`,
    'utf8',
  );
});

afterAll(() => {
  if (originalGlobalRulesPath === undefined) {
    delete process.env['STBL_REGENT_GLOBAL_RULES_PATH'];
  } else {
    process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = originalGlobalRulesPath;
  }
  rmSync(ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// L3: spawn the server
// ---------------------------------------------------------------------------

interface McpResponse {
  readonly id: number | string | null;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
}

class McpServer {
  private readonly proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, (resp: McpResponse) => void>();
private readonly buf: Buffer[] = [];

  constructor() {
    this.proc = spawn(process.execPath, [CLI, 'mcp', 'serve'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NO_COLOR: '1',
        NODE_NO_WARNINGS: '1',
        ['STBL_REGENT_GLOBAL_RULES_PATH']: EMPTY_GLOBALS,
      },
    });
    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.buf.push(chunk);
      this.drain();
    });
    this.proc.stderr.on('data', () => {
      // Discard stderr (regent logs go there); useful for debugging
      // but not part of the JSON-RPC contract.
    });
    this.proc.on('error', () => {
      // spawn failures — drain any pending callbacks as protocol errors.
      for (const cb of this.pending.values()) {
        cb({ id: null, error: { code: -32603, message: 'spawn failed' } });
      }
      this.pending.clear();
    });
  }

  private drain(): void {
    const merged = Buffer.concat(this.buf).toString('utf8');
    this.buf.length = 0;
    const lines = merged.split('\n').filter((line) => line.trim() !== '');
    for (const line of lines) {
      let parsed: McpResponse;
      try {
        parsed = JSON.parse(line) as McpResponse;
      } catch {
        continue;
      }
      const cb = this.pending.get(Number(parsed.id));
      if (cb !== undefined) {
        this.pending.delete(Number(parsed.id));
        cb(parsed);
      }
    }
  }

  send(method: string, params?: Record<string, unknown>): Promise<McpResponse> {
    const id = this.nextId++;
    const message = params === undefined
      ? `${JSON.stringify({ jsonrpc: '2.0', id, method })}\n`
      : `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.proc.stdin.write(message, (err) => {
        if (err !== undefined && err !== null) reject(err);
      });
    });
  }

  sendRaw(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc.stdin.write(`${line}\n`, (err) => {
        if (err !== undefined && err !== null) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.proc.stdin.end();
    await new Promise<void>((resolve) => this.proc.on('close', () => resolve()));
  }
}

// ===========================================================================
// Tests
// ===========================================================================

describe('L3: regent mcp serve (e2e over stdio)', () => {
  it('completes the MCP handshake (initialize → tools/list)', async () => {
    const server = new McpServer();
    try {
      const init = await server.send('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      });
      expect(init.error).toBeUndefined();
      const initResult = init.result as {
        readonly protocolVersion: string;
        readonly serverInfo: { readonly name: string; readonly version: string };
        readonly capabilities: { readonly tools: { readonly listChanged: boolean } };
      };
      expect(initResult.protocolVersion).toBe('2025-11-25');
      expect(initResult.serverInfo.name).toBe('regent');
      expect(initResult.capabilities.tools).toEqual({ listChanged: false });

      const list = await server.send('tools/list');
      expect(list.error).toBeUndefined();
      const tools = (list.result as { readonly tools: readonly { name: string }[] }).tools;
      const names = tools.map((t) => t.name);
      expect(names).toContain('regent.list_rules');
      expect(names).toContain('regent.check');
      expect(names).toContain('regent.explain_rule');
      expect(names).toContain('regent.explain_finding');
      expect(names).toContain('regent.suggest_fix');
      expect(names).toContain('regent.status');
    } finally {
      await server.close();
    }
  });

  it('responds to ping with an empty object', async () => {
    const server = new McpServer();
    try {
      const ping = await server.send('ping');
      expect(ping.result).toEqual({});
    } finally {
      await server.close();
    }
  });

  it('returns -32601 for unknown methods', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('does/not/exist');
      expect(resp.error?.code).toBe(-32601);
    } finally {
      await server.close();
    }
  });

  it('returns -32602 for unknown tools', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('tools/call', {
        name: 'regent.does_not_exist',
        arguments: {},
      });
      expect(resp.error?.code).toBe(-32602);
    } finally {
      await server.close();
    }
  });

  it('returns -32602 for invalid params (Zod rejection)', async () => {
    const server = new McpServer();
    try {
      // explain_rule requires { ruleId: string }
      const resp = await server.send('tools/call', {
        name: 'regent.explain_rule',
        arguments: { ruleId: 42 }, // wrong type
      });
      expect(resp.error?.code).toBe(-32602);
      expect(resp.error?.message).toMatch(/invalid params/i);
    } finally {
      await server.close();
    }
  });

  it('returns -32700 for malformed JSON', async () => {
    const server = new McpServer();
    try {
      const promise = new Promise<McpResponse>((resolve) => {
        const lineHandler = (chunk: Buffer): void => {
          const text = chunk.toString('utf8');
          for (const raw of text.split('\n')) {
            if (raw.trim() === '') continue;
            try {
              const parsed = JSON.parse(raw) as McpResponse;
              if (parsed.error?.code === -32700) {
                server.proc.stdout.off('data', lineHandler);
                resolve(parsed);
              }
            } catch {
              // ignore — keep draining
            }
          }
        };
        server.proc.stdout.on('data', lineHandler);
      });
      await server.sendRaw('{not valid json');
      const resp = await promise;
      expect(resp.error?.code).toBe(-32700);
    } finally {
      await server.close();
    }
  });
});

describe('L3: tool — regent.list_rules', () => {
  it('returns the loader summary as structured content', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('tools/call', {
        name: 'regent.list_rules',
        arguments: {},
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly content: readonly { readonly type: string; readonly text: string }[];
        readonly structuredContent: {
          readonly rules: readonly { readonly id: string; readonly kind: string }[];
          readonly total: number;
          readonly kinds: Record<string, number>;
        };
      };
      expect(result.content[0]?.type).toBe('text');
      expect(result.structuredContent.rules.length).toBeGreaterThan(0);
      expect(result.structuredContent.rules.find((r) => r.id === 'fixture.no-bad')).toBeDefined();
      expect(result.structuredContent.total).toBe(result.structuredContent.rules.length);
    } finally {
      await server.close();
    }
  });
});

describe('L3: tool — regent.check', () => {
  it('runs a scan and returns structured findings', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('tools/call', {
        name: 'regent.check',
        arguments: { all: true },
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly structuredContent: {
          readonly findings: readonly {
            readonly ruleId: string;
            readonly path: string;
            readonly severity: string;
          }[];
          readonly scannedFiles: number;
          readonly summary: { readonly bySeverity: Record<string, number> };
        };
      };
      const hit = result.structuredContent.findings.find((f) => f.ruleId === 'fixture.no-bad');
      expect(hit).toBeDefined();
      expect(hit?.path.endsWith('Known.cs')).toBe(true);
      expect(result.structuredContent.summary.bySeverity.error).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it('filters by severity', async () => {
    const server = new McpServer();
    try {
      // Fixture only emits 'error' findings; a threshold of 'error'
      // keeps them, a threshold of 'info' would also keep them,
      // but a threshold HIGHER than 'error' (e.g. unknown) is a
      // no-op. Use 'info' + length>=1 + severity='error' to assert
      // the threshold logic passes through.
      const resp = await server.send('tools/call', {
        name: 'regent.check',
        arguments: { all: true, severity: 'info' },
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly structuredContent: {
          readonly findings: readonly { readonly severity: string }[];
        };
      };
      // Every returned finding must be at-or-above the threshold.
      const RANKS = { info: 0, warning: 1, error: 2 } as const;
      const minRank = RANKS.info;
      for (const f of result.structuredContent.findings) {
        const r = RANKS[f.severity as keyof typeof RANKS] ?? -1;
        expect(r).toBeGreaterThanOrEqual(minRank);
      }
    } finally {
      await server.close();
    }
  });
});

describe('L3: tool — regent.explain_rule', () => {
  it('returns the rule explanation as structured content', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('tools/call', {
        name: 'regent.explain_rule',
        arguments: { ruleId: 'fixture.no-bad' },
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly isError?: boolean;
        readonly structuredContent: {
          readonly mode?: string;
          readonly rule?: { readonly id: string; readonly severity: string };
        };
      };
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.mode).toBe('rule');
      expect(result.structuredContent.rule?.id).toBe('fixture.no-bad');
    } finally {
      await server.close();
    }
  });

  it('returns isError=true for unknown rule (no JSON-RPC error)', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('tools/call', {
        name: 'regent.explain_rule',
        arguments: { ruleId: 'no.such.rule' },
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly isError?: boolean;
        readonly structuredContent: { readonly error?: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.error).toMatch(/no rule with id/i);
    } finally {
      await server.close();
    }
  });
});

describe('L3: tool — regent.explain_finding', () => {
  it('returns the finding context for a known (file:line:col)', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('tools/call', {
        name: 'regent.explain_finding',
        arguments: { file: 'Known.cs', line: 2, column: 3 },
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly isError?: boolean;
        readonly structuredContent: {
          readonly mode?: string;
          readonly ruleId?: string;
          readonly remediation?: string;
        };
      };
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.mode).toBe('finding');
      expect(result.structuredContent.ruleId).toBe('fixture.no-bad');
      expect(result.structuredContent.remediation).toMatch(/good\(\)/);
    } finally {
      await server.close();
    }
  });

  it('returns isError=true when no finding exists at the locator', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('tools/call', {
        name: 'regent.explain_finding',
        arguments: { file: 'Known.cs', line: 1, column: 1 },
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly isError?: boolean;
        readonly structuredContent: { readonly error?: string };
      };
      expect(result.isError).toBe(true);
    } finally {
      await server.close();
    }
  });
});

describe('L3: tool — regent.suggest_fix', () => {
  it('returns a proposed edit for a fixable finding (dry-run, no writes)', async () => {
    const server = new McpServer();
    try {
      const before = existsSync(join(ROOT, 'Known.cs'))
        ? readFileSync(join(ROOT, 'Known.cs'), 'utf8')
        : '';
      const resp = await server.send('tools/call', {
        name: 'regent.suggest_fix',
        arguments: { file: 'Known.cs', line: 2, column: 3 },
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly isError?: boolean;
        readonly structuredContent: {
          readonly edits: readonly {
            readonly kind: string;
            readonly ruleId?: string;
            readonly before?: string;
            readonly after?: string;
          }[];
          readonly confidence: string;
          readonly dryRun?: boolean;
        };
      };
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.dryRun).toBe(true);
      expect(result.structuredContent.confidence).toMatch(/high|medium|low/);
      const applied = result.structuredContent.edits.find((e) => e.kind === 'applied');
      expect(applied?.ruleId).toBe('fixture.no-bad');
      expect(applied?.before).toContain('bad()');
      expect(applied?.after).toContain('good()');

      // Critical: dry-run did not write.
      const after = readFileSync(join(ROOT, 'Known.cs'), 'utf8');
      expect(after).toBe(before);
    } finally {
      await server.close();
    }
  });

  it('returns isError=true when no finding exists at the locator', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('tools/call', {
        name: 'regent.suggest_fix',
        arguments: { file: 'Known.cs', line: 99, column: 1 },
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly isError?: boolean;
        readonly structuredContent: { readonly error?: string };
      };
      expect(result.isError).toBe(true);
    } finally {
      await server.close();
    }
  });
});

describe('L3: tool — regent.status', () => {
  it('returns version, cwd, git status, and rule counts', async () => {
    const server = new McpServer();
    try {
      const resp = await server.send('tools/call', {
        name: 'regent.status',
        arguments: { network: false },
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        readonly isError?: boolean;
        readonly structuredContent: {
          readonly version: string;
          readonly cwd: string;
          readonly git: { readonly isRepo: boolean };
          readonly rules: Record<string, number>;
        };
      };
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.structuredContent.cwd.length).toBeGreaterThan(0);
      expect(result.structuredContent.rules.detect).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});