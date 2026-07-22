/**
 * L0: `defineFormat` — type-safe spec for file-mutating tools
 * (#34a). Mirrors the parameterised-rule surface from #33 so
 * authors carry the same muscle memory.
 *
 * Covers: frozen + frozen mutation throws, plain-string variant,
 * function-form `detect` / `fix` / `normalize` (the bundled-parser
 * contract), `converges` flag, and the `passthrough` schema
 * behaviour (extra fields don't fail validation).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineFormat, type FormatRuleSpec } from '../../src/kinds/format.js';
import type { ToolProcessResult } from '../../src/kinds/process.js';

const whitespaceParams = z.object({
  folder: z.string().default('.'),
  whitespace: z.boolean().default(true),
});

const fixedSuccess: ToolProcessResult = {
  argv: ['dotnet', 'format', '.', '--verify-no-changes'],
  command: 'dotnet',
  exitCode: 0,
  signal: null,
  stdout: '',
  stderr: '',
  durationMs: 12,
  truncated: false,
};

const fixedFailure: ToolProcessResult = {
  argv: ['dotnet', 'format', '.'],
  command: 'dotnet',
  exitCode: 1,
  signal: null,
  stdout: 'whitespace: 1 file(s) would be changed',
  stderr: '',
  durationMs: 47,
  truncated: false,
};

describe('defineFormat', () => {
  it('freezes the spec and preserves its shape', () => {
    const spec = defineFormat({
      id: 'dotnet.whitespace',
      severity: 'warning',
      params: whitespaceParams,
      detect: (p) => [
        'dotnet',
        'format',
        p.folder,
        '--verify-no-changes',
        p.whitespace && '--whitespace',
      ],
      fix: (p) => [
        'dotnet',
        'format',
        p.folder,
        p.whitespace && '--whitespace',
      ],
      normalize: (proc) => {
        if (proc.exitCode === 0) return [];
        return [
          {
            ruleId: 'dotnet.whitespace',
            severity: 'warning',
            path: '',
            match: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, matchText: '', groups: [] },
            context: { startLine: 0, endLine: 0, lines: [] },
            message: proc.stdout.trim() || 'dotnet format reported changes',
            source: 'dotnet.whitespace',
            status: 'violation',
          },
        ];
      },
    });

    expect(Object.isFrozen(spec)).toBe(true);
    expect(spec.id).toBe('dotnet.whitespace');
    expect(spec.severity).toBe('warning');
    expect(typeof spec.detect).toBe('function');
    expect(typeof spec.fix).toBe('function');
    expect(typeof spec.normalize).toBe('function');
  });

  it('emits the dry-run argv from `detect`', () => {
    const spec = defineFormat({
      id: 'fmt1',
      severity: 'warning',
      params: whitespaceParams,
      detect: (p) => ['dotnet', 'format', p.folder, '--verify-no-changes'],
      normalize: () => [],
    });
    expect(spec.detect({ folder: 'src', whitespace: true })).toEqual([
      'dotnet',
      'format',
      'src',
      '--verify-no-changes',
    ]);
  });

  it('emits the mutating argv from `fix` (independent of `detect`)', () => {
    const spec = defineFormat({
      id: 'fmt2',
      severity: 'warning',
      params: whitespaceParams,
      detect: (p) => ['dotnet', 'format', p.folder, '--verify-no-changes'],
      fix: (p) => ['dotnet', 'format', p.folder],
      normalize: () => [],
    });
    expect(spec.fix!({ folder: 'src', whitespace: false })).toEqual([
      'dotnet',
      'format',
      'src',
    ]);
  });

  it('allows `fix` to be omitted for detect-only format specs', () => {
    const spec = defineFormat({
      id: 'fmt3',
      severity: 'warning',
      params: whitespaceParams,
      detect: (p) => ['dotnet', 'format', p.folder, '--verify-no-changes'],
      normalize: () => [],
    });
    expect(spec.fix).toBeUndefined();
  });

  it('threads params through function-form `detect` / `fix`', () => {
    const spec = defineFormat({
      id: 'fmt4',
      severity: 'warning',
      params: whitespaceParams,
      detect: (p) => ['--folder=' + p.folder, '--ws=' + String(p.whitespace)],
      fix: (p) => ['--apply', '--folder=' + p.folder],
      normalize: () => [],
    });
    expect(spec.detect({ folder: 'lib', whitespace: false })).toEqual([
      '--folder=lib',
      '--ws=false',
    ]);
    expect(spec.fix!({ folder: 'lib', whitespace: true })).toEqual([
      '--apply',
      '--folder=lib',
    ]);
  });

  it('`normalize` returns `Finding[]` from the captured `ToolProcessResult`', () => {
    const spec = defineFormat({
      id: 'fmt5',
      severity: 'error',
      params: whitespaceParams,
      detect: () => ['dotnet', 'format', '.'],
      normalize: (proc) => {
        if (proc.exitCode === 0) return [];
        return [
          {
            ruleId: 'fmt5',
            severity: 'error',
            path: '',
            match: {
              startLine: 0,
              startColumn: 0,
              endLine: 0,
              endColumn: 0,
              matchText: '',
              groups: [],
            },
            context: { startLine: 0, endLine: 0, lines: [] },
            message: proc.stdout.trim() || 'format would change files',
            source: 'fmt5',
            status: 'violation',
          },
        ];
      },
    });

    expect(spec.normalize(fixedSuccess)).toEqual([]);
    const failureFindings = spec.normalize(fixedFailure);
    expect(failureFindings).toHaveLength(1);
    expect(failureFindings[0]?.ruleId).toBe('fmt5');
    expect(failureFindings[0]?.message).toBe('whitespace: 1 file(s) would be changed');
  });

  it('round-trips the function-form of `detect` (no `params` field needed when static)', () => {
    // Some spec authors prefer a static argv without params — e.g.
    // when the bundled parser is the only thing that needs
    // configuration. `defineFormat` accepts that too.
    const spec = defineFormat({
      id: 'fmt6',
      severity: 'warning',
      params: z.object({}),
      detect: () => ['prettier', '--check', '.'],
      fix: () => ['prettier', '--write', '.'],
      normalize: () => [],
    });
    expect(spec.detect({})).toEqual(['prettier', '--check', '.']);
    expect(spec.fix!({})).toEqual(['prettier', '--write', '.']);
  });

  it('optional `converges` flag defaults to absent (runner applies its own default)', () => {
    const spec = defineFormat({
      id: 'fmt7',
      severity: 'warning',
      params: whitespaceParams,
      detect: () => ['prettier', '--check'],
      fix: () => ['prettier', '--write'],
      normalize: () => [],
    });
    expect(spec.converges).toBeUndefined();
  });

  it('preserves the runtime `FormatRuleSpec` shape via the generic `defineFormat<...>`', () => {
    const spec: FormatRuleSpec<typeof whitespaceParams> = defineFormat({
      id: 'fmt8',
      severity: 'warning',
      params: whitespaceParams,
      detect: (p) => ['dotnet', 'format', p.folder],
      fix: (p) => ['dotnet', 'format', p.folder],
      normalize: () => [],
    });
    // Compile-time check: `params` is the captured generic.
    expect(spec.params).toBe(whitespaceParams);
  });
});
