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
});
