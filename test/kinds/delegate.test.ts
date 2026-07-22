/**
 * L0: `defineDelegate` — type-safe spec for read-only analysis
 * tools (#34a). Read-only counterpart to `defineFormat`; no `fix`.
 *
 * Covers: frozen + plain-string variant, function-form `detect` /
 * `normalize`, missing `fix` is the type-level guarantee (the
 * surface does not have a `fix` field), and the bundled-parser
 * pattern.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { defineDelegate, type DelegateRuleSpec } from '../../src/kinds/delegate.js';
import type { ToolProcessResult } from '../../src/kinds/process.js';

const eslintParams = z.object({
  files: z.array(z.string()).default(['src']),
});

const successRun: ToolProcessResult = {
  argv: ['eslint', '--format', 'json', 'src'],
  command: 'eslint',
  exitCode: 0,
  signal: null,
  stdout: '[]',
  stderr: '',
  durationMs: 250,
  truncated: false,
};

const findingsRun: ToolProcessResult = {
  argv: ['eslint', '--format', 'json', 'src'],
  command: 'eslint',
  exitCode: 1,
  signal: null,
  stdout: '[{"filePath":"src/a.ts","messages":[{"ruleId":"x","severity":2,"message":"hi","line":1,"column":1}]}]',
  stderr: '',
  durationMs: 305,
  truncated: false,
};

describe('defineDelegate', () => {
  it('freezes the spec and preserves its shape', () => {
    const spec = defineDelegate({
      id: 'eslint.security',
      severity: 'error',
      params: eslintParams,
      detect: (p) => ['eslint', '--format', 'json', ...p.files],
      normalize: () => [],
    });
    expect(Object.isFrozen(spec)).toBe(true);
    expect(spec.id).toBe('eslint.security');
    expect(spec.severity).toBe('error');
    expect(typeof spec.detect).toBe('function');
    expect(typeof spec.normalize).toBe('function');
  });

  it('does NOT expose a `fix` field (read-only contract)', () => {
    const spec = defineDelegate({
      id: 'eslint1',
      severity: 'warning',
      params: eslintParams,
      detect: (p) => ['eslint', '--format', 'json', ...p.files],
      normalize: () => [],
    });
    // `DelegateRuleSpec` has no `fix` — use type-level assertion.
    expectTypeOf(spec).toMatchTypeOf<{ readonly id: string }>();
    expect('fix' in spec).toBe(false);
  });

  it('emits the detect argv from params', () => {
    const spec = defineDelegate({
      id: 'eslint2',
      severity: 'warning',
      params: eslintParams,
      detect: (p) => ['eslint', '--format', 'json', ...p.files],
      normalize: () => [],
    });
    expect(spec.detect({ files: ['src/a.ts', 'src/b.ts'] })).toEqual([
      'eslint',
      '--format',
      'json',
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('parses JSON-shaped tool output into `Finding[]`', () => {
    const spec = defineDelegate({
      id: 'eslint3',
      severity: 'warning',
      params: eslintParams,
      detect: () => ['eslint', '--format', 'json'],
      normalize: (proc) => {
        if (proc.exitCode === 0) return [];
        type EslintMessage = {
          ruleId: string;
          severity: 1 | 2;
          message: string;
          line: number;
          column: number;
        };
        type EslintReport = {
          filePath: string;
          messages: EslintMessage[];
        }[];
        const parsed = JSON.parse(proc.stdout || '[]') as EslintReport;
        return parsed.map((entry) => {
          const msg = entry.messages[0]!;
          return {
            ruleId: 'eslint3',
            severity: msg.severity === 2 ? 'error' : 'warning',
            path: entry.filePath,
            match: {
              startLine: msg.line - 1,
              startColumn: msg.column - 1,
              endLine: msg.line - 1,
              endColumn: msg.column,
              matchText: msg.message,
              groups: [],
            },
            context: { startLine: msg.line - 1, endLine: msg.line - 1, lines: [] },
            message: msg.message,
            source: 'eslint3',
            status: 'violation',
          };
        });
      },
    });

    expect(spec.normalize(successRun)).toEqual([]);
    const findings = spec.normalize(findingsRun);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('eslint3');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.path).toBe('src/a.ts');
    expect(findings[0]?.message).toBe('hi');
  });

  it('preserves the type contract for `DelegateRuleSpec`', () => {
    const spec: DelegateRuleSpec<typeof eslintParams> = defineDelegate({
      id: 'eslint4',
      severity: 'warning',
      params: eslintParams,
      detect: (p) => ['eslint', ...p.files],
      normalize: () => [],
    });
    expect(spec.params).toBe(eslintParams);
  });

  it('static-argv variant (no `params`) is accepted for simple bundles', () => {
    const spec = defineDelegate({
      id: 'tsc.check',
      severity: 'warning',
      params: z.object({}),
      detect: () => ['tsc', '--noEmit'],
      normalize: () => [],
    });
    expect(spec.detect({})).toEqual(['tsc', '--noEmit']);
  });
});
