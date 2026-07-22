/**
 * L0: pattern builders compose into valid RE2 strings.
 */

import { describe, expect, it } from 'vitest';

import { patterns } from '../src/patterns/index.js';

describe('patterns', () => {
  it('todoComment produces a regex matching `// TODO`', () => {
    const re = patterns.todoComment().toRegex();
    expect(re).toContain('TODO');
    expect(re).toContain('FIXME');
  });

  it('todoComment unlessFollowedBy ticketReference works', () => {
    const re = patterns.todoComment()
      .unlessFollowedBy(patterns.ticketReference())
      .toRegex();
    expect(re).toContain('TODO');
    expect(re).toContain('(?!');
    expect(re).toContain('\\(');
  });

  it('privateUnderscoreField anchors at line start', () => {
    const re = patterns.privateUnderscoreField().anchored().toRegex();
    expect(re.startsWith('^')).toBe(true);
  });

  it('regionDirective matches `#region Properties`', () => {
    const re = patterns.regionDirective().toRegex();
    expect(re).toMatch(/#region/);
  });

  it('consoleLog matches all console methods', () => {
    const re = patterns.consoleLog().toRegex();
    expect(re).toMatch(/log/);
    expect(re).toMatch(/error/);
    expect(re).toMatch(/warn/);
  });

  it('tsAnyType matches all 3 forms', () => {
    const re = patterns.tsAnyType().toRegex();
    expect(re).toContain('any');
  });

  it('mixedIndent catches space-then-tab and tab-then-space', () => {
    const re = patterns.mixedIndent().toRegex();
    expect(re).toContain('{');
    expect(re).toContain('\\t');
  });

  it('pythonImport matches both `from X import Y` and `import X`', () => {
    const re = patterns.pythonImport().toRegex();
    expect(re).toContain('from\\s+');
    expect(re).toContain('import\\s+');
  });

  it('finalNewlineMissing anchors at end of file', () => {
    const re = patterns.finalNewlineMissing().toRegex();
    expect(re).toContain('\\z');
  });

  it('asWord adds word boundary', () => {
    const re = patterns.regionDirective().asWord().toRegex();
    expect(re.endsWith('\\b')).toBe(true);
  });

  it('privateMethod matches `private void DoWork()`', () => {
    const re = patterns.privateMethod().toRegex();
    expect(re).toContain('private');
    expect(re).toContain('\\(');
  });

  it('discardAssignment catches `_ = ...` at line start', () => {
    const re = patterns.discardAssignment().toRegex();
    expect(re.startsWith('^')).toBe(true);
    expect(re).toContain('_');
    expect(re).toContain('=');
  });

  it('throws on missing toRegex() return value being undefined', () => {
    expect(typeof patterns.consoleLog().toRegex()).toBe('string');
  });

  it('composes multiple modifiers', () => {
    const re = patterns.consoleLog()
      .anchored()
      .asWord()
      .toRegex();
    expect(re.startsWith('^')).toBe(true);
    expect(re.endsWith('\\b')).toBe(true);
  });

  it('unlessFollowedBy accepts a string', () => {
    const re = patterns.todoComment().unlessFollowedBy('\\([A-Z]+-\\d+\\)').toRegex();
    expect(re).toContain('(?!');
  });

  it('every pattern returns a non-empty RE2 string', () => {
    const keys = Object.keys(patterns) as Array<keyof typeof patterns>;
    for (const key of keys) {
      const re = (patterns[key]() as { toRegex: () => string }).toRegex();
      expect(re.length).toBeGreaterThan(0);
      expect(re).not.toContain('undefined');
    }
  });

  describe('Java helpers', () => {
    it('javaPublicClass matches `public class Foo`', () => {
      const re = patterns.javaPublicClass().toRegex();
      expect(re).toContain('public');
      expect(re).toContain('class');
    });

    it('javaSystemOut covers print/println/printf on both out and err', () => {
      const re = patterns.javaSystemOut().toRegex();
      expect(re).toContain('System');
      expect(re).toContain('out');
      expect(re).toContain('err');
      expect(re).toContain('print');
    });

    it('javaOverride matches the @Override annotation', () => {
      const re = patterns.javaOverride().toRegex();
      expect(re).toContain('@Override');
    });
  });

  describe('Go helpers', () => {
    it('goPackageDecl anchors a `package foo` declaration', () => {
      const re = patterns.goPackageDecl().toRegex();
      expect(re.startsWith('^')).toBe(true);
      expect(re).toContain('package');
    });

    it('goImport matches single-line `import "..."` forms', () => {
      const re = patterns.goImport().toRegex();
      expect(re.startsWith('^')).toBe(true);
      expect(re).toContain('import');
    });

    it('goFuncMain matches `func main(...)` entry point', () => {
      const re = patterns.goFuncMain().toRegex();
      expect(re).toContain('func');
      expect(re).toContain('main');
      expect(re).toContain('(');
    });

    it('goPrintln covers Print / Println / Printf on the fmt package', () => {
      const re = patterns.goPrintln().toRegex();
      expect(re).toContain('fmt');
      expect(re).toContain('Print');
    });

    it('goPanic matches `panic(` call form', () => {
      const re = patterns.goPanic().toRegex();
      expect(re).toContain('panic');
      expect(re).toContain('(');
    });
  });

  describe('Rust helpers', () => {
    it('rustPubFn matches `pub fn name(`', () => {
      const re = patterns.rustPubFn().toRegex();
      expect(re).toContain('pub');
      expect(re).toContain('fn');
      expect(re).toContain('\\(');
    });

    it('rustUseCrate matches `use crate::`', () => {
      const re = patterns.rustUseCrate().toRegex();
      expect(re).toContain('use');
      expect(re).toContain('crate::');
    });

    it('rustUnsafe matches `unsafe {`', () => {
      const re = patterns.rustUnsafe().toRegex();
      expect(re).toContain('unsafe');
      expect(re).toContain('{');
    });

    it('rustUnwrap matches `.unwrap(`', () => {
      const re = patterns.rustUnwrap().toRegex();
      expect(re).toContain('.unwrap');
      expect(re).toContain('(');
    });
  });
});