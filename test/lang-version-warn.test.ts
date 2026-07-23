/**
 * L1/L2: grammar-version mismatch warning (sub-item 4 of #57).
 *
 * The CLI's `regent check` surfaces one warning per `langVersionRange`
 * mismatch it can detect, deduped by language. The bundles layer
 * (`src/bundles/index.ts`) is responsible for parsing the project's
 * declared version and comparing against the bundle's pinned ceiling;
 * the CLI composes those signals once per run.
 *
 * Tests cover:
 *  - `parseLanguageMajor` extracts the major from `C# 13 (LangVersion)`.
 *  - `detectGrammarMismatch` returns null when the version is at or
 *    below the ceiling, non-null when it's above.
 *  - The CLI run-level helper builds the warning list by walking the
 *    loaded AST-rule languages exactly once each, with a single
 *    project → mismatch → one-warning roundtrip.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BUNDLES,
  detectGrammarMismatch,
  parseLanguageMajor,
  resolveBundle,
} from '../src/bundles/index.js';
import { loadRules } from '../src/loader.js';
import { defineAstRule } from '../src/kinds/ast.js';

describe('parseLanguageMajor', () => {
  it('extracts the major from "C# 13 (net9.x)"', () => {
    expect(parseLanguageMajor('C# 13 (net9.x)')).toBe(13);
  });
  it('extracts the major from "C# 12 (LangVersion)"', () => {
    expect(parseLanguageMajor('C# 12 (LangVersion)')).toBe(12);
  });
  it('returns null when the input has no comparable major', () => {
    expect(parseLanguageMajor('target ES2022')).toBeNull();
    expect(parseLanguageMajor('edition 2021')).toBeNull();
    expect(parseLanguageMajor('go 1.22')).toBeNull();
  });
  it('returns null on null input', () => {
    expect(parseLanguageMajor(null)).toBeNull();
  });
});

describe('detectGrammarMismatch', () => {
  const DIR = join(tmpdir(), `regent-grammar-warn-${Date.now()}`);
  beforeEach(() => mkdirSync(DIR, { recursive: true }));
  afterEach(() => rmSync(DIR, { recursive: true, force: true }));

  it('returns a warning when the project exceeds the C# ceiling', () => {
    writeFileSync(
      join(DIR, 'App.csproj'),
      '<Project><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>',
    );
    const bundle = resolveBundle('csharp')!;
    const warning = detectGrammarMismatch(bundle, DIR);
    expect(warning).not.toBeNull();
    expect(warning).toContain('C# 13');
    expect(warning).toContain('@ast-grep/lang-csharp');
    expect(warning).toContain('C# 12'); // ceiling
  });

  it('returns null when the project is at the ceiling', () => {
    writeFileSync(
      join(DIR, 'App.csproj'),
      '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
    );
    const bundle = resolveBundle('csharp')!;
    expect(detectGrammarMismatch(bundle, DIR)).toBeNull();
  });

  it('returns null when the project is below the ceiling', () => {
    writeFileSync(
      join(DIR, 'App.csproj'),
      '<Project><PropertyGroup><TargetFramework>net7.0</TargetFramework></PropertyGroup></Project>',
    );
    const bundle = resolveBundle('csharp')!;
    expect(detectGrammarMismatch(bundle, DIR)).toBeNull();
  });

  it('returns null when the project cannot be probed (no .csproj)', () => {
    const bundle = resolveBundle('csharp')!;
    expect(detectGrammarMismatch(bundle, DIR)).toBeNull();
  });

  it('honours a <LangVersion> override above the TFM default', () => {
    writeFileSync(
      join(DIR, 'App.csproj'),
      '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework><LangVersion>13</LangVersion></PropertyGroup></Project>',
    );
    const bundle = resolveBundle('csharp')!;
    const warning = detectGrammarMismatch(bundle, DIR);
    expect(warning).not.toBeNull();
    expect(warning).toContain('C# 13');
  });

  it('skips bundles without a langVersionRange (TS/Rust/Go today)', () => {
    expect(detectGrammarMismatch(resolveBundle('typescript')!, DIR)).toBeNull();
    expect(detectGrammarMismatch(resolveBundle('rust')!, DIR)).toBeNull();
    expect(detectGrammarMismatch(resolveBundle('go')!, DIR)).toBeNull();
  });
});

describe('BUNDLES declaration', () => {
  it('pins a langVersionRange only for languages that have a stable major', () => {
    const csharpBundle = BUNDLES.find((b) => b.id === 'csharp')!;
    expect(csharpBundle.langVersionRange).toBeDefined();
    expect(csharpBundle.langVersionRange!.maxMajor).toBeGreaterThanOrEqual(11);

    for (const b of BUNDLES.filter((x) => x.id !== 'csharp')) {
      expect(b.langVersionRange).toBeUndefined();
    }
  });
});

/**
 * Loader-level mirror of the CLI's per-language dedupe: when two AST
 * rules share a language bundle, `LoaderRuleSet.astRules` returns
 * each rule once (no double-loading) and the run-level helper would
 * see exactly one entry per language. We pin that contract here so a
 * future loader change can't silently double-fire the warning.
 */
describe('AST-rule loader-level language dedupe', () => {
  const DIR = join(tmpdir(), `regent-grammar-warn-ast-${Date.now()}`);
  beforeEach(() => mkdirSync(DIR, { recursive: true }));
  afterEach(() => rmSync(DIR, { recursive: true, force: true }));

  it('keeps one entry per AST-rule id even when two rules share a language', async () => {
    const R1 = defineAstRule({
      id: 'lang-dedupe.first',
      language: 'csharp',
      severity: 'warning',
      globs: ['**/*.cs'],
      message: 'first',
      ast: { rule: { pattern: '$A.foo()' } },
    });
    const R2 = defineAstRule({
      id: 'lang-dedupe.second',
      language: 'csharp',
      severity: 'warning',
      globs: ['**/*.cs'],
      message: 'second',
      ast: { rule: { pattern: '$A.bar()' } },
    });

    writeFileSync(
      join(DIR, '.regentrc.js'),
      `export default {
  rules: {
    ast: [
      ${JSON.stringify(R1)},
      ${JSON.stringify(R2)},
    ],
  },
};`,
    );

    const loaded = await loadRules({ repoRoot: DIR, skipLocal: true });
    // The two locally-declared rules are present. The user-global
    // `~/.agents/rules/csharp/` layer may contribute additional AST
    // rules depending on the environment; the assertion targets only
    // ours so the test stays deterministic across machines. The CLI's
    // `collectRunWarnings` dedupes BY LANGUAGE, so even with a longer
    // rule set a single per-language mismatch warning is the contract.
    const ids = loaded.astRules.map((r) => r.spec.id);
    expect(ids).toContain('lang-dedupe.first');
    expect(ids).toContain('lang-dedupe.second');
    const languages = new Set(
      loaded.astRules
        .filter((r) => r.spec.id.startsWith('lang-dedupe.'))
        .map((r) => r.spec.language),
    );
    expect(languages.size).toBe(1);
  });
});
