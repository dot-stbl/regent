/**
 * L1: llm schema JSON emitter — `regent llm schema detect-rule --json` /
 * `regent llm schema fix-rule --json`.
 *
 * Validates:
 *   - output is JSON.parse-able
 *   - has `$schema: ...draft/2020-12/schema`
 *   - is a non-empty object schema with `properties`, `required`, `type: object`
 *   - mentions every required field from the source Zod schema
 *   - CLI integration: `regent llm schema detect-rule --json` / `schema fix-rule --json`
 *     exit 0 with the expected document shape on stdout
 *
 * P5 (#62) renamed the rule-spec schema routes to `detect-rule` and
 * `fix-rule` so `regent llm schema fix` could be repurposed for the
 * new v1 OUTPUT schema (`fix-v1.json` — see `test/fixer-json-schema.test.ts`).
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderDetectSchemaJson, renderFixRuleSchemaJson } from '../src/llm-schema.js';

const REPO = join(tmpdir(), `regent-llm-schema-smoke-${Date.now()}`);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

beforeAll(() => {
  mkdirSync(REPO, { recursive: true });
});

afterAll(() => {
  rmSync(REPO, { recursive: true, force: true });
});

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO,
      env: { ...process.env, NO_COLOR: '1' },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on('data', (chunk) => stdout.push(chunk));
    proc.stderr.on('data', (chunk) => stderr.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function pickRequired(schema: { required?: string[] } | null | undefined): string[] {
  return Array.isArray(schema?.required) ? schema!.required! : [];
}

function pickProperties(
  schema: { properties?: Record<string, unknown> } | null | undefined,
): Record<string, unknown> {
  return schema?.properties ?? {};
}

function pickDefinition(
  doc: { definitions?: Record<string, unknown>; $ref?: string },
  name: string,
): Record<string, unknown> | null {
  // The emitter uses `target: 'jsonSchema2019-09'` + `$refStrategy: 'root'`,
  // so the actual schema sits at `definitions[name]` and `$ref` points at it.
  if (!doc.$ref || !doc.definitions) {
    return null;
  }
  // $ref like "#/definitions/DetectRuleSpec"
  const match = doc.$ref.match(/^#\/definitions\/(.+)$/);
  if (!match || match[1] !== name) {
    return null;
  }
  const def = doc.definitions[name];
  return typeof def === 'object' && def !== null ? (def as Record<string, unknown>) : null;
}

describe('renderDetectSchemaJson', () => {
  const json = renderDetectSchemaJson();
  let doc: Record<string, unknown>;

  it('emits valid JSON', () => {
    expect(() => { doc = JSON.parse(json); }).not.toThrow();
    expect(typeof doc).toBe('object');
  });

  it('declares JSON Schema 2020-12', () => {
    doc = JSON.parse(json);
    expect(doc.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('exposes the rule spec via $ref + definitions', () => {
    doc = JSON.parse(json);
    const def = pickDefinition(doc as { definitions?: Record<string, unknown>; $ref?: string }, 'DetectRuleSpec');
    expect(def).not.toBeNull();
    expect(def!['type']).toBe('object');
  });

  it('includes every required field from the source Zod schema', () => {
    doc = JSON.parse(json);
    const def = pickDefinition(doc as { definitions?: Record<string, unknown>; $ref?: string }, 'DetectRuleSpec');
    expect(def).not.toBeNull();
    const required = pickRequired(def as { required?: string[] });
    expect(required).toEqual(expect.arrayContaining(['id', 'severity', 'pattern', 'globs', 'message']));
  });

  it('declares every optional field in properties', () => {
    doc = JSON.parse(json);
    const def = pickDefinition(doc as { definitions?: Record<string, unknown>; $ref?: string }, 'DetectRuleSpec');
    expect(def).not.toBeNull();
    const props = pickProperties(def as { properties?: Record<string, unknown> });
    // All Zod fields — required + optional — must be present.
    expect(Object.keys(props).sort()).toEqual(
      expect.arrayContaining([
        'id', 'severity', 'pattern', 'excludeWhen', 'globs',
        'excludePaths', 'message', 'source', 'rationale', 'review', 'dependsOn',
      ]),
    );
  });

  it('forbids additionalProperties (parity with Zod .strict())', () => {
    doc = JSON.parse(json);
    const def = pickDefinition(doc as { definitions?: Record<string, unknown>; $ref?: string }, 'DetectRuleSpec');
    expect(def!['additionalProperties']).toBe(false);
  });

  it('includes the title and description from the wrapper', () => {
    doc = JSON.parse(json);
    expect(doc.title).toBe('regent detect-rule spec');
    expect(typeof doc.description).toBe('string');
    expect((doc.description as string).length).toBeGreaterThan(0);
  });
});

describe('renderFixRuleSchemaJson', () => {
  const json = renderFixRuleSchemaJson();
  let doc: Record<string, unknown>;

  it('emits valid JSON', () => {
    expect(() => { doc = JSON.parse(json); }).not.toThrow();
  });

  it('declares JSON Schema 2020-12', () => {
    doc = JSON.parse(json);
    expect(doc.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('exposes FixRuleSpec with required find+replace', () => {
    doc = JSON.parse(json);
    const def = pickDefinition(doc as { definitions?: Record<string, unknown>; $ref?: string }, 'FixRuleSpec');
    expect(def).not.toBeNull();
    expect(def!['type']).toBe('object');
    const required = pickRequired(def as { required?: string[] });
    expect(required).toEqual(expect.arrayContaining(['id', 'severity', 'find', 'replace', 'globs', 'message']));
    // replace is allowed to be empty (delete match) so NOT marked required — verify that.
    expect(required).not.toContain('all');
    expect(required).not.toContain('excludePaths');
    expect(required).not.toContain('dependsOn');
  });

  it('forbids additionalProperties (parity with Zod .strict())', () => {
    doc = JSON.parse(json);
    const def = pickDefinition(doc as { definitions?: Record<string, unknown>; $ref?: string }, 'FixRuleSpec');
    expect(def!['additionalProperties']).toBe(false);
  });

  it('does not surface detect-only fields (pattern, excludeWhen)', () => {
    doc = JSON.parse(json);
    const def = pickDefinition(doc as { definitions?: Record<string, unknown>; $ref?: string }, 'FixRuleSpec');
    const props = pickProperties(def as { properties?: Record<string, unknown> });
    expect(Object.keys(props)).not.toContain('pattern');
    expect(Object.keys(props)).not.toContain('excludeWhen');
    expect(Object.keys(props)).not.toContain('review');
  });
});

describe('regent llm schema --json CLI integration', () => {
  it('build artefact exists for CLI tests', () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it('regent llm schema detect-rule --json emits the JSON schema and exits 0', async () => {
    const r = await runCli(['llm', 'schema', 'detect-rule', '--json']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(parsed.$ref).toBe('#/definitions/DetectRuleSpec');
    expect(parsed.definitions.DetectRuleSpec.required).toEqual(
      expect.arrayContaining(['id', 'severity', 'pattern', 'globs', 'message']),
    );
  });

  it('regent llm schema fix-rule --json emits the JSON schema and exits 0', async () => {
    const r = await runCli(['llm', 'schema', 'fix-rule', '--json']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(parsed.$ref).toBe('#/definitions/FixRuleSpec');
    expect(parsed.definitions.FixRuleSpec.required).toEqual(
      expect.arrayContaining(['id', 'severity', 'find', 'replace', 'globs', 'message']),
    );
  });

  it('regent llm schema detect (no flag) still emits markdown', async () => {
    const r = await runCli(['llm', 'schema', 'detect']);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/^\s*\{\s*"\$schema"/);
    expect(r.stdout).toContain('Schema');
  });

  it('--json with an invalid subcommand exits 2', async () => {
    const r = await runCli(['llm', 'examples', '--json']);
    expect(r.code).toBe(2);
  });
});