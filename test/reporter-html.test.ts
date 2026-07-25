/**
 * L1: reporter unit — HTML reporter for `regent check --format html`.
 *
 * Asserts the contract for the new format:
 *   - empty finding set → empty table, "no findings" message
 *   - N findings → N rows
 *   - self-contained: no external URLs in any href / src / link attribute
 *   - valid HTML scaffolding: <!doctype html>, <html>, <head>, <body>, </html>
 *   - HTML-escapes user-supplied strings (no XSS vector from rule id, message,
 *     file path, code content)
 *   - code-excerpt row appears once per finding with a non-empty context
 *   - synthetic findings (no path) render without a location cell, not as
 *     a crash
 *   - prefers-color-scheme CSS lives in the same <style> block (light + dark)
 *   - <5 MB even for a 50-finding report (synthetic, large contexts)
 *
 * Snapshot test: render a known 3-finding fixture, compare to a golden file
 * under test/__fixtures__/html/snapshot.html. The golden is committed; if
 * the report's output changes deliberately, regenerate via
 * `node -e "..."` and overwrite the golden (the test prints the diff).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderHtml, escapeHtml } from '../src/reporter/html.js';
import type { Finding } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, '__fixtures__', 'html', 'snapshot.html');

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  ruleId: 'csharp.no-private-methods',
  severity: 'error',
  path: '/abs/repo/src/Foo.cs',
  match: {
    startLine: 41,
    startColumn: 4,
    endLine: 41,
    endColumn: 27,
    matchText: 'private void Bar() {',
  },
  context: {
    startLine: 39,
    endLine: 44,
    lines: [
      'public sealed class Foo',
      '{',
      '    private readonly ILogger _log;',
      '    private void Bar() {',
      '        return;',
      '    }',
    ],
  },
  message: 'no private methods in production code',
  source: 'code-shape.md#no-private-business-logic',
  ...overrides,
});

describe('renderHtml', () => {
  it('renders a valid empty document when there are no findings', () => {
    const out = renderHtml(
      { findings: [], rules: [], scannedFiles: 0 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(out).toContain('<html lang="en">');
    expect(out).toContain('</html>');
    expect(out).toContain('no findings');
    expect(out).toContain('No findings.');
    // The findings table is present but empty.
    expect(out).toContain('<table class="findings">');
    expect(out).not.toContain('<tr class="finding"');
  });

  it('renders one <tr class="finding"> row per finding', () => {
    const findings = [
      baseFinding(),
      baseFinding({ ruleId: 'csharp.no-region-directive', severity: 'warning' }),
      baseFinding({ ruleId: 'csharp.no-todo-without-owner', severity: 'suggestion' }),
    ];
    const out = renderHtml(
      { findings, rules: [], scannedFiles: 10 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    const rowCount = (out.match(/<tr class="finding"/g) ?? []).length;
    expect(rowCount).toBe(3);
  });

  it('emits a context excerpt row per finding (paired with the finding row)', () => {
    const out = renderHtml(
      { findings: [baseFinding()], rules: [], scannedFiles: 1 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    const findings = (out.match(/<tr class="finding"/g) ?? []).length;
    const excerpts = (out.match(/<tr class="excerpt"/g) ?? []).length;
    expect(findings).toBe(1);
    expect(excerpts).toBe(1);
    expect(out).toContain('<pre class="code">');
    expect(out).toContain('private void Bar()');
  });

  it('is fully self-contained: no <script>, no external src/href beyond the package homepage', () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      baseFinding({ ruleId: `csharp.no-private-methods-${i}` }),
    );
    const out = renderHtml(
      { findings, rules: [], scannedFiles: 5 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('</script>');

    // Collect every `href` / `src` attribute in the document and assert
    // that the only http(s) URL is the package homepage in the footer.
    // (We deliberately keep that one anchor for traceability — it is
    // not a CDN, just a plain link.)
    const allHrefs = out.match(new RegExp('(?:href|src)\\s*=\\s*["\']([^"\']+)["\']', 'g')) ?? [];
    for (const tag of allHrefs) {
      const match = tag.match(/["']([^"']+)["']/);
      const url = match?.[1] ?? '';
      if (url.startsWith('http')) {
        expect(url).toBe('https://github.com/dot-stbl/regent');
      }
    }
  });

  it('escapes HTML in user-supplied strings (no XSS vector)', () => {
    const malicious: Finding = baseFinding({
      ruleId: 'test.<script>alert(1)</script>',
      message: 'you & me < " \' > `',
      path: '/abs/repo/src/<img src=x>.cs',
      context: {
        startLine: 0,
        endLine: 1,
        lines: ['<script>alert("x")</script>'],
      },
    });
    const out = renderHtml(
      { findings: [malicious], rules: [], scannedFiles: 1 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).not.toContain('<script>alert("x")</script>');
    // The literal text appears in escaped form.
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&amp;');
    // escapeHtml() unit:
    expect(escapeHtml('"hi" & <b>')).toBe('&quot;hi&quot; &amp; &lt;b&gt;');
  });

  it('renders escaped AST node and capture metadata', () => {
    const finding = baseFinding({
      ast: { nodeType: 'invocation_expression', captured: { ARG: '"<Name>"' } },
    });
    const out = renderHtml(
      { findings: [finding], rules: [], scannedFiles: 1 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    expect(out).toContain('Node: <code>invocation_expression</code>');
    expect(out).toContain('Captures: <code>ARG = &quot;&lt;Name&gt;&quot;</code>');
  });

  it('handles synthetic findings (empty path, negative line) without crashing', () => {
    const synthetic: Finding = baseFinding({
      path: '',
      match: {
        startLine: -1,
        startColumn: 0,
        endLine: -1,
        endColumn: 0,
        matchText: '',
      },
      context: { startLine: 0, endLine: 0, lines: [] },
    });
    const out = renderHtml(
      { findings: [synthetic], rules: [], scannedFiles: 0 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    expect(out).toContain('synthetic');
    // No code-excerpt row for a finding with no context.
    expect(out).not.toContain('<tr class="excerpt"');
  });

  it('emits light + dark CSS via prefers-color-scheme in a single style block', () => {
    const out = renderHtml(
      { findings: [], rules: [], scannedFiles: 0 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    const styleBlock = out.match(/<style>([\s\S]*?)<\/style>/);
    expect(styleBlock).not.toBeNull();
    const css = styleBlock![1]!;
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain('--bg');
    expect(css).toContain('--ink');
    expect(css).toContain('chip-error');
    expect(css).toContain('chip-warning');
    expect(css).toContain('chip-suggestion');
  });

  it('renders the header with project name, timestamp, scan stats', () => {
    const out = renderHtml(
      { findings: [], rules: [], scannedFiles: 42 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    expect(out).toContain('regent check report');
    expect(out).toContain('<dt>Project</dt>');
    expect(out).toContain('<dt>Files scanned</dt><dd>42</dd>');
    expect(out).toContain('<dt>Generated</dt>');
    expect(out).toContain('<time datetime=');
  });

  it('groups by severity in the summary chips', () => {
    const findings = [
      baseFinding({ severity: 'error', ruleId: 'a' }),
      baseFinding({ severity: 'error', ruleId: 'b' }),
      baseFinding({ severity: 'warning', ruleId: 'c' }),
      baseFinding({ severity: 'suggestion', ruleId: 'd' }),
    ];
    const out = renderHtml(
      { findings, rules: [], scannedFiles: 1 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    expect(out).toContain('2 errors');
    expect(out).toContain('1 warning');
    expect(out).toContain('1 suggestion');
  });

  it('emits a code-excerpt match-line emphasis for the matched range', () => {
    const finding: Finding = baseFinding({
      match: {
        startLine: 41,
        startColumn: 4,
        endLine: 41,
        endColumn: 27,
        matchText: 'private void Bar() {',
      },
    });
    const out = renderHtml(
      { findings: [finding], rules: [], scannedFiles: 1 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    // The match line should carry `class="line match"`, the others `class="line dim"`.
    expect(out).toMatch(/<span class="line match">/);
    expect(out).toMatch(/<span class="line dim">/);
  });

  it('stays under 5 MB for a 50-finding report (defensive size budget)', () => {
    const findings = Array.from({ length: 50 }, (_, i) =>
      baseFinding({
        ruleId: `csharp.no-private-methods-${i}`,
        message: `custom message for finding #${i} with some padding to bulk up the rendered string`,
        path: `/abs/repo/src/SomeFile${i}.cs`,
        match: { startLine: 10 + i, startColumn: 4, endLine: 10 + i, endColumn: 30, matchText: 'x' },
        context: {
          startLine: 8 + i,
          endLine: 14 + i,
          lines: [
            'public sealed class SomeFile' + i,
            '{',
            '    private readonly ILogger _log;',
            '    private void Bar() {',
            '        return;',
            '    }',
            '}',
          ],
        },
      }),
    );
    const out = renderHtml(
      { findings, rules: [], scannedFiles: 100 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    const bytes = Buffer.byteLength(out, 'utf8');
    expect(bytes).toBeLessThan(5 * 1024 * 1024);
    // Tighter assertion: a 50-finding report is well under 100 KB on
    // this implementation. Catches accidental bloat (e.g. embedding
    // full file contents) early.
    expect(bytes).toBeLessThan(100 * 1024);
  });

  it('produces valid HTML scaffolding (doctype + html + head + body)', () => {
    const out = renderHtml(
      { findings: [baseFinding()], rules: [], scannedFiles: 1 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );
    // Open + close of every major container.
    expect(out).toMatch(/^<!DOCTYPE html>/);
    expect(out).toMatch(/<html lang="en">/);
    expect(out).toMatch(/<head>/);
    expect(out).toMatch(/<body>/);
    expect(out).toMatch(/<\/body>/);
    expect(out).toMatch(/<\/html>/);
    // Mature HTML docs end with a single trailing newline.
    expect(out.endsWith('\n')).toBe(true);
  });

  it('normalises Windows-style paths to forward slash in the location cell', () => {
    const winFinding: Finding = baseFinding({ path: 'C:\\repo\\src\\Foo.cs' });
    const out = renderHtml(
      { findings: [winFinding], rules: [], scannedFiles: 1 },
      { cwd: 'C:\\repo', version: '0.5.2' },
    );
    expect(out).toContain('src/Foo.cs');
    expect(out).not.toContain('C:\\repo\\src\\Foo.cs');
  });
});

describe('renderHtml — snapshot (golden file)', () => {
  it('matches the committed golden for a 3-finding fixture', () => {
    const findings = [
      baseFinding(),
      baseFinding({
        ruleId: 'csharp.no-region-directive',
        severity: 'warning',
        path: '/abs/repo/src/Foo.cs',
        match: { startLine: 4, startColumn: 0, endLine: 4, endColumn: 11, matchText: '    #region' },
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
      }),
      baseFinding({
        ruleId: 'meta.trailing-newline',
        severity: 'suggestion',
        path: '/abs/repo/src/Bar.cs',
        match: { startLine: 8, startColumn: 0, endLine: 8, endColumn: 1, matchText: '' },
        context: {
          startLine: 5,
          endLine: 9,
          lines: [
            'public class Bar',
            '{',
            '    int x;',
            '}',
            ''  // missing trailing newline
          ],
        },
        message: 'file must end with a trailing newline',
        source: 'meta.md#trailing-newline',
        rationale: 'POSIX text files end with a newline so cat does not bleed into the next prompt.',
      }),
    ];
    const out = renderHtml(
      { findings, rules: [], scannedFiles: 12 },
      { cwd: '/abs/repo', version: '0.5.2' },
    );

    let golden: string;
    try {
      golden = readFileSync(GOLDEN, 'utf8');
    } catch {
      // First run with no golden yet — write it for the next test
      // pass and assert the bytes are sane. Subsequent runs will
      // compare against the committed golden.
      throw new Error(
        `golden not found at ${GOLDEN}; run with --update or commit the file after the first render`,
      );
    }

    // Replace the dynamic `<time datetime>` value in the golden before
    // comparison (timestamps in the rendered header must not be baked
    // into a snapshot).
    const normalisedOut = out.replace(
      /<time datetime="[^"]+">[^<]+<\/time>/,
      '<time datetime="TIMESTAMP">TIMESTAMP</time>',
    );
    const normalisedGolden = golden.replace(
      /<time datetime="[^"]+">[^<]+<\/time>/,
      '<time datetime="TIMESTAMP">TIMESTAMP</time>',
    );

    expect(normalisedOut).toBe(normalisedGolden);
  });
});
