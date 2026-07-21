/**
 * L1: reporter unit — text reporter output
 *
 * Golden-file-style assertions on key fragments: severity tags, gutter
 * alignment, source link.
 */

import { describe, expect, it } from 'vitest';

import { renderText } from '../src/reporter/text.js';
import type { Finding } from '../src/types.js';

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  ruleId: 'csharp.no-private-methods',
  severity: 'error',
  path: '/abs/path/src/Foo.cs',
  match: {
    startLine: 41,
    startColumn: 0,
    endLine: 41,
    endColumn: 38,
    matchText: '    private void Bar() {',
  },
  context: {
    startLine: 38,
    endLine: 44,
    lines: [
      'public class Foo',
      '{',
      '    private readonly ILogger _log;',
      '    private void Bar() {',
      '        return;',
      '    }',
      '}',
    ],
  },
  message: 'no private methods in production code',
  source: 'code-shape.md#no-private-business-logic',
  ...overrides,
});

describe('renderText', () => {
  it('emits the success line when there are no findings', () => {
    const output = renderText([], { cwd: '/abs/path', useColor: false });
    expect(output).toContain('no findings');
  });

  it('renders finding header with relative path + line number', () => {
    const out = renderText([baseFinding()], { cwd: '/abs/path', useColor: false });
    expect(out).toContain('42');
    expect(out).toContain('error');
    expect(out).toContain('csharp.no-private-methods');
  });

  it('includes the rule message + source link', () => {
    const out = renderText([baseFinding()], { cwd: '/abs/path', useColor: false });
    expect(out).toContain('no private methods in production code');
    expect(out).toContain('code-shape.md#no-private-business-logic');
  });

  it('renders multi-line context with gutter alignment', () => {
    const out = renderText([baseFinding()], { cwd: '/abs/path', useColor: false });
    expect(out).toContain('│ ');          // gutter separator
    expect(out).toContain('public class Foo');
    expect(out).toContain('}');
  });

  it('uses NO ANSI codes when useColor=false', () => {
    const out = renderText([baseFinding()], { cwd: '/abs/path', useColor: false });
    expect(out).not.toContain('\u001b[');
  });

  it('uses ANSI codes when useColor=true', () => {
    const out = renderText([baseFinding()], { cwd: '/abs/path', useColor: true });
    expect(out).toContain('\u001b[');
  });

  it('groups multiple findings by file', () => {
    const f1 = baseFinding();
    const f2 = baseFinding({ ruleId: 'csharp.no-region-directive' });
    const out = renderText([f1, f2], { cwd: '/abs/path', useColor: false });
    expect(out).toContain('42');
  });

  it('wraps long Source: links when columns is set, keeping the gutter intact', () => {
    const finding = baseFinding({
      path: '/abs/path/src/Hybrid.Modules.Billing/Hybrid.Modules.Billing.Application/Wallets/WalletHandlers.cs',
      source: 'exceptions.md#no-catch-all',
    });
    const out = renderText([finding], {
      cwd: '/abs/path',
      useColor: false,
      columns: 80,
    });
    // No row should exceed the visible width budget (gutter + content).
    for (const row of out.split('\n')) {
      expect(row.length).toBeLessThanOrEqual(80);
    }
    // Gutter character still present — frame survived the wrap.
    expect(out).toContain('│ ');
    // `Source:` row should be on its own line with the 2-space prefix preserved.
    const sourceRow = out
      .split('\n')
      .find((row) => row.includes('Source:') && !row.includes('│ '));
    expect(sourceRow).toBeDefined();
    expect(sourceRow!.startsWith('  Source:')).toBe(true);
  });

  it('keeps the gutter indent on continuation rows when a context line is long', () => {
    const finding = baseFinding({
      context: {
        startLine: 229,
        endLine: 232,
        lines: [
          '        catch (Exception ex)',
          '        {',
          '            diagnostics.WalletFrozenCount.WithTag("reason", "failed").Add(1);',
          '            logger.LogError(ex,',
        ],
      },
    });
    const out = renderText([finding], {
      cwd: '/abs/path',
      useColor: false,
      columns: 60,
    });
    for (const row of out.split('\n')) {
      expect(row.length).toBeLessThanOrEqual(60);
    }
    // At least one body row carries the 2-space indent (gutter rows or
    // continuation rows).
    const hasIndented = out.split('\n').some((row) => row.startsWith('  '));
    expect(hasIndented).toBe(true);
    // Gutter character still appears at least once.
    expect(out).toContain('│ ');
  });

  it('does not double-add the indent on the wrapped Source row', () => {
    const finding = baseFinding({ source: 'exceptions.md#no-catch-all' });
    const out = renderText([finding], {
      cwd: '/abs/path',
      useColor: false,
      columns: 40,
    });
    // Each visual row should start with EITHER '  ' (indent for body rows)
    // or no indent at all (header at column 0). No row should start with
    // 4 spaces (which would mean we double-prepended).
    for (const row of out.split('\n')) {
      expect(row.startsWith('    ')).toBe(false);
    }
    // The text 'Source:' must still appear.
    expect(out).toContain('Source:');
  });

  it('columns is optional — when omitted, output is unchanged from before', () => {
    const finding = baseFinding();
    const noOpt = renderText([finding], { cwd: '/abs/path', useColor: false });
    const withUndef = renderText([finding], { cwd: '/abs/path', useColor: false, columns: undefined });
    expect(noOpt).toBe(withUndef);
  });
});
