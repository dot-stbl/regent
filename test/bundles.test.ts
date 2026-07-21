/**
 * L0/L1: language bundles — resolution, per-language version detection, and
 * a multi-language scan smoke (csharp / typescript / rust / go).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BUNDLES, resolveBundle } from '../src/bundles/index.js';
import { scanAst } from '../src/ast/matcher.js';

describe('resolveBundle', () => {
  it('resolves canonical ids and aliases (case-insensitive)', () => {
    expect(resolveBundle('csharp')?.id).toBe('csharp');
    expect(resolveBundle('cs')?.id).toBe('csharp');
    expect(resolveBundle('C#')?.id).toBe('csharp');
    expect(resolveBundle('ts')?.id).toBe('typescript');
    expect(resolveBundle('rs')?.id).toBe('rust');
    expect(resolveBundle('golang')?.id).toBe('go');
    expect(resolveBundle('cobol')).toBeNull();
  });

  it('ships the four requested languages', () => {
    expect(BUNDLES.map((b) => b.id).sort()).toEqual(['csharp', 'go', 'rust', 'typescript']);
  });
});

describe('detectProjectVersion', () => {
  const DIR = join(tmpdir(), `regent-bundles-${Date.now()}`);
  beforeAll(() => {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, 'App.csproj'), '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>');
    writeFileSync(join(DIR, 'tsconfig.json'), '{ "compilerOptions": { "target": "ES2022" } }');
    writeFileSync(join(DIR, 'Cargo.toml'), '[package]\nname = "x"\nedition = "2021"\n');
    writeFileSync(join(DIR, 'go.mod'), 'module x\n\ngo 1.22\n');
  });
  afterAll(() => rmSync(DIR, { recursive: true, force: true }));

  it('maps a .NET TFM to the C# language version', () => {
    expect(resolveBundle('csharp')!.detectProjectVersion(DIR)).toBe('C# 12 (net8.x)');
  });
  it('reads the TypeScript target', () => {
    expect(resolveBundle('typescript')!.detectProjectVersion(DIR)).toBe('target ES2022');
  });
  it('reads the Rust edition', () => {
    expect(resolveBundle('rust')!.detectProjectVersion(DIR)).toBe('edition 2021');
  });
  it('reads the Go version', () => {
    expect(resolveBundle('go')!.detectProjectVersion(DIR)).toBe('go 1.22');
  });
  it('returns null when nothing is detectable', () => {
    expect(resolveBundle('go')!.detectProjectVersion(tmpdir())).toBeNull();
  });
});

describe('scanAst across languages', () => {
  it('csharp: string-arg .Property', async () => {
    const m = await scanAst('csharp', 'void C(){ b.Property("Name"); }', {
      rule: { pattern: '$O.Property($A)' }, constraints: { A: { has: { kind: 'string_literal' } } },
    });
    expect(m).toHaveLength(1);
  });
  it('typescript: console.log via alias "ts"', async () => {
    const m = await scanAst('ts', 'console.log("hi"); const x = 1;', { rule: { pattern: 'console.log($A)' } });
    expect(m).toHaveLength(1);
  });
  it('rust: .unwrap()', async () => {
    const m = await scanAst('rust', 'fn f(v: Option<i32>) { let _ = v.unwrap(); }', { rule: { pattern: '$X.unwrap()' } });
    expect(m).toHaveLength(1);
  });
  it('go: a function call', async () => {
    const m = await scanAst('go', 'package m\nfunc f() { fmt.Println("hi") }\n', { rule: { pattern: '$X($A)' } });
    expect(m.length).toBeGreaterThanOrEqual(1);
  });
});
