/**
 * L1: JSON reporter for `regent check --format json`.
 *
 * Validates the document shape declared in issue #17:
 *   - top-level: { rules, findings, scannedFiles, warnings }
 *   - rules[]:    { id, severity, message, source }
 *   - findings[]: { ruleId, severity, path, match, context, message,
 *                   source, status }
 *   - match:      { line (1-indexed), column (1-indexed), text }
 *   - context:    { lines, startLine (1-indexed), endLine (1-indexed) }
 *   - status:     'violation' | 'pending' | 'accepted'
 *   - warnings:   per-run advisories (sub-items 2 + 4 of #57);
 *                 optional consumer-visible string[] always present
 *
 * Also validates edge cases:
 *   - empty findings still produces a valid document
 *   - 0-indexed Match offsets are converted to 1-indexed positions
 *   - paths are repo-relative + forward-slash (Windows-friendly)
 */

import { describe, expect, it } from 'vitest';

import {
  renderJson,
  renderJsonFromRun,
  withScannedFiles,
} from '../src/reporter/json.js';
import type { CompiledRule, Finding } from '../src/types.js';

const rule: CompiledRule = {
  spec: {
    id: 'csharp.no-region-directive',
    severity: 'error',
    pattern: '^\\s*#region\\s',
    globs: ['**/*.cs'],
    message: '#region forbidden',
    source: 'code-shape.md#no-region',
  },
  source: 'code-shape.md#no-region',
  origin: { kind: 'repo', path: 'examples/csharp/no-region-directive.lint.ts' },
};

const finding: Finding = {
  ruleId: 'csharp.no-region-directive',
  severity: 'error',
  path: '/abs/src/Foo.cs',
  match: {
    startLine: 4,
    startColumn: 0,
    endLine: 4,
    endColumn: 16,
    matchText: '    #region',
  },
  context: {
    startLine: 1,
    endLine: 7,
    lines: [
      'public class Foo',
      '{',
      '    int x;',
      '    #region',
      '    int y;',
      '    #endregion',
      '}',
    ],
  },
  message: '#region forbidden',
  source: 'code-shape.md#no-region',
  status: 'violation',
};

describe('renderJson', () => {
  it('produces the documented top-level shape', () => {
    const result = renderJson([finding], [rule], { cwd: '/abs' });
    expect(Object.keys(result).sort()).toEqual(
      ['findings', 'rules', 'scannedFiles', 'warnings'],
    );
    // No advisories by default — sub-items 2 + 4 of #57 surface these
    // only when the runner detects a real signal (regex-rule load or
    // grammar-mismatch). Tests for those code paths live in
    // `test/regex-deprecation.test.ts` + `test/lang-version-warn.test.ts`.
    expect(result.warnings).toEqual([]);
  });

  it('attaches one rule descriptor per compiled rule', () => {
    const result = renderJson([finding], [rule], { cwd: '/abs' });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      id: 'csharp.no-region-directive',
      severity: 'error',
      message: '#region forbidden',
      source: 'code-shape.md#no-region',
    });
  });

  it('shapes findings per the documented contract', () => {
    const result = renderJson([finding], [rule], { cwd: '/abs' });
    const jsonFinding = result.findings[0]!;
    expect(jsonFinding.ruleId).toBe('csharp.no-region-directive');
    expect(jsonFinding.severity).toBe('error');
    expect(jsonFinding.path).toBe('src/Foo.cs');
    expect(jsonFinding.match).toEqual({
      line: 5,        // 0-indexed 4 → 1-indexed 5
      column: 1,      // 0-indexed 0 → 1-indexed 1
      text: '    #region',
    });
    expect(jsonFinding.context).toEqual({
      lines: [
        'public class Foo',
        '{',
        '    int x;',
        '    #region',
        '    int y;',
        '    #endregion',
        '}',
      ],
      startLine: 2,   // 0-indexed 1 → 1-indexed 2
      endLine: 8,     // 0-indexed 7 → 1-indexed 8
    });
    expect(jsonFinding.message).toBe('#region forbidden');
    expect(jsonFinding.source).toBe('code-shape.md#no-region');
    expect(jsonFinding.status).toBe('violation');
  });

  it('emits forward-slash + repo-relative paths on Windows input', () => {
    const winFinding: Finding = { ...finding, path: 'C:\\repo\\src\\Foo.cs' };
    const result = renderJson([winFinding], [rule], { cwd: 'C:\\repo' });
    expect(result.findings[0]!.path).not.toContain('\\');
    expect(result.findings[0]!.path).toBe('src/Foo.cs');
  });

  it('preserves tri-state status values verbatim', () => {
    const pendingFinding: Finding = { ...finding, status: 'pending' };
    const acceptedFinding: Finding = { ...finding, status: 'accepted' };
    const result = renderJson(
      [pendingFinding, acceptedFinding],
      [rule],
      { cwd: '/abs' },
    );
    expect(result.findings.map((f) => f.status).sort()).toEqual(['accepted', 'pending']);
  });

  it('produces a valid empty document when there are no findings', () => {
    const result = renderJson([], [rule], { cwd: '/abs' });
    expect(result.rules).toHaveLength(1);
    expect(result.findings).toEqual([]);
    expect(result.scannedFiles).toBe(0);
    // Must round-trip through JSON.stringify + JSON.parse.
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.findings).toEqual([]);
    expect(parsed.rules).toHaveLength(1);
  });

  it('produces a valid empty document with no rules either', () => {
    const result = renderJson([], [], { cwd: '/abs' });
    expect(result.rules).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.scannedFiles).toBe(0);
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('withScannedFiles', () => {
  it('attaches scannedFiles from the runner without mutating the input', () => {
    const base = renderJson([finding], [rule], { cwd: '/abs' });
    const decorated = withScannedFiles(base, 42);
    expect(decorated.scannedFiles).toBe(42);
    // base still has the placeholder value
    expect(base.scannedFiles).toBe(0);
  });
});

describe('renderJsonFromRun', () => {
  it('produces a JSON-stringified document with newline', () => {
    const json = renderJsonFromRun(
      { findings: [finding], rules: [rule], scannedFiles: 7 },
      { cwd: '/abs' },
    );
    expect(json.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.scannedFiles).toBe(7);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.rules).toHaveLength(1);
  });
});