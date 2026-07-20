/**
 * L1: reporter unit — SARIF 2.1 roundtrip
 *
 * Asserts the produced SARIF conforms to schema shape:
 *   - $schema, version 2.1.0
 *   - one runs[] entry per regent invocation
 *   - tool.driver.rules[] populated for every distinct rule id
 *   - result.ruleId + result.level + result.locations[].physicalLocation.region
 */

import { describe, expect, it } from 'vitest';

import { renderSarif } from '../src/reporter/sarif.js';
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
  origin: { kind: 'preset', preset: 'csharp' },
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
  rationale: 'regions hide structure',
};

describe('renderSarif', () => {
  it('produces SARIF 2.1 with one run', () => {
    const json = renderSarif([finding], [rule], { cwd: '/abs' });
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs).toHaveLength(1);
  });

  it('attaches a reportingDescriptor per rule', () => {
    const json = renderSarif([finding], [rule], { cwd: '/abs' });
    const parsed = JSON.parse(json);
    const descriptors = parsed.runs[0].tool.driver.rules;
    expect(descriptors.find((d: { id: string }) => d.id === 'csharp.no-region-directive'))
      .toBeTruthy();
  });

  it('produces a result with ruleId + level + location', () => {
    const json = renderSarif([finding], [rule], { cwd: '/abs' });
    const parsed = JSON.parse(json);
    const result = parsed.runs[0].results[0];
    expect(result.ruleId).toBe('csharp.no-region-directive');
    expect(result.level).toBe('error');
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('src/Foo.cs');
    expect(result.locations[0].physicalLocation.region.startLine).toBe(5);
  });

  it('produces a contextRegion with snippet', () => {
    const json = renderSarif([finding], [rule], { cwd: '/abs' });
    const parsed = JSON.parse(json);
    const region = parsed.runs[0].results[0].locations[0].physicalLocation.contextRegion;
    expect(region.startLine).toBe(2);
    expect(region.endLine).toBe(8);
    expect(region.snippet.text).toContain('public class Foo');
  });

  it('emits forward-slash URIs from Windows-style input paths', () => {
    const winFinding = { ...finding, path: 'C:\\repo\\src\\Foo.cs' };
    const json = renderSarif([winFinding], [rule], { cwd: 'C:\\repo' });
    const parsed = JSON.parse(json);
    const uri = parsed.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    // SARIF spec: URIs must use forward slashes regardless of source OS
    expect(uri).not.toContain('\\');
    // The file basename survives normalization regardless of platform
    expect(uri).toMatch(/Foo\.cs$/);
  });

  it('maps severity: warning to SARIF level "warning"', () => {
    const warnFinding = { ...finding, severity: 'warning' as const };
    const json = renderSarif([warnFinding], [rule], { cwd: '/abs' });
    const parsed = JSON.parse(json);
    expect(parsed.runs[0].results[0].level).toBe('warning');
  });

  it('maps severity: suggestion to SARIF level "note"', () => {
    const sugFinding = { ...finding, severity: 'suggestion' as const };
    const json = renderSarif([sugFinding], [rule], { cwd: '/abs' });
    const parsed = JSON.parse(json);
    expect(parsed.runs[0].results[0].level).toBe('note');
  });
});
