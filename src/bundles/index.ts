// Language bundles — a "bundle" is a language PARSE setup: which ast-grep
// lang pack supplies the tree-sitter grammar, plus version metadata. Rules
// reference a language; regent uses the matching bundle to parse. This is
// regent's language-support layer — NOT a rule pack (users still author
// their own rules; regent ships the parsers).
//
// Language-version support model:
//   - The lang pack (`@ast-grep/lang-<x>`) pins the tree-sitter grammar,
//     which parses the language up to some version. tree-sitter is
//     error-tolerant, so a slightly-older grammar still parses newer code
//     and only degrades on genuinely-new syntax. Bump the pack to advance.
//     The version treadmill is thus offloaded to the lang-pack releases.
//   - `detectProjectVersion()` reads the project's declared language version
//     (`.csproj <LangVersion>`/TFM, `tsconfig` target, `Cargo.toml` edition,
//     `go.mod`). regent surfaces it (and can warn when it's beyond what the
//     pinned grammar is known to cover) via `regent bundles`.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface LanguageBundle {
  /** Canonical language id used in rule specs + registration. */
  readonly id: string;
  /** Accepted aliases (lower-cased). */
  readonly aliases: readonly string[];
  /** npm package that supplies the tree-sitter grammar. */
  readonly pack: string;
  /** Sensible default globs for the language. */
  readonly defaultGlobs: readonly string[];
  /** Human note on what the pinned grammar is known to parse. */
  readonly grammarSupports: string;
  /** Detect the project's declared language version under `cwd`, or null. */
  detectProjectVersion(cwd: string): string | null;
}

function readIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

/** Map a .NET target-framework major to the default C# language version. */
function csharpFromTfm(tfmMajor: number): string | null {
  const map: Record<number, string> = { 5: '9', 6: '10', 7: '11', 8: '12', 9: '13' };
  return map[tfmMajor] ?? null;
}

function detectCsharp(cwd: string): string | null {
  let csproj: string | null = null;
  try {
    const name = readdirSync(cwd).find((f) => f.endsWith('.csproj'));
    if (name) {
      csproj = readIfExists(join(cwd, name));
    }
  } catch {
    return null;
  }
  if (csproj === null) {
    return null;
  }
  const lang = csproj.match(/<LangVersion>\s*([^<\s]+)\s*<\/LangVersion>/i);
  if (lang?.[1]) {
    return `C# ${lang[1]} (LangVersion)`;
  }
  const tfm = csproj.match(/<TargetFramework[^>]*>\s*net(\d+)\.\d+/i);
  if (tfm?.[1]) {
    const cs = csharpFromTfm(Number(tfm[1]));
    return cs ? `C# ${cs} (net${tfm[1]}.x)` : `net${tfm[1]}.x`;
  }
  return null;
}

function detectTypescript(cwd: string): string | null {
  const text = readIfExists(join(cwd, 'tsconfig.json'));
  if (text === null) {
    return null;
  }
  const target = text.match(/"target"\s*:\s*"([^"]+)"/i);
  return target?.[1] ? `target ${target[1]}` : null;
}

function detectRust(cwd: string): string | null {
  const text = readIfExists(join(cwd, 'Cargo.toml'));
  if (text === null) {
    return null;
  }
  const edition = text.match(/^\s*edition\s*=\s*"([^"]+)"/m);
  return edition?.[1] ? `edition ${edition[1]}` : null;
}

function detectGo(cwd: string): string | null {
  const text = readIfExists(join(cwd, 'go.mod'));
  if (text === null) {
    return null;
  }
  const go = text.match(/^\s*go\s+(\d+\.\d+(?:\.\d+)?)/m);
  return go?.[1] ? `go ${go[1]}` : null;
}

export const BUNDLES: readonly LanguageBundle[] = [
  {
    id: 'csharp',
    aliases: ['cs', 'c#'],
    pack: '@ast-grep/lang-csharp',
    defaultGlobs: ['**/*.cs'],
    grammarSupports: 'modern C# (up to ~13); newer syntax degrades gracefully',
    detectProjectVersion: detectCsharp,
  },
  {
    id: 'typescript',
    aliases: ['ts', 'tsx'],
    pack: '@ast-grep/lang-typescript',
    defaultGlobs: ['**/*.ts', '**/*.tsx'],
    grammarSupports: 'TypeScript 5.x',
    detectProjectVersion: detectTypescript,
  },
  {
    id: 'rust',
    aliases: ['rs'],
    pack: '@ast-grep/lang-rust',
    defaultGlobs: ['**/*.rs'],
    grammarSupports: 'Rust 2015/2018/2021 editions',
    detectProjectVersion: detectRust,
  },
  {
    id: 'go',
    aliases: ['golang'],
    pack: '@ast-grep/lang-go',
    defaultGlobs: ['**/*.go'],
    grammarSupports: 'Go 1.x (generics included)',
    detectProjectVersion: detectGo,
  },
];

/** Resolve a language id or alias (case-insensitive) to its bundle, or null. */
export function resolveBundle(idOrAlias: string): LanguageBundle | null {
  const key = idOrAlias.toLowerCase();
  return BUNDLES.find((b) => b.id === key || b.aliases.includes(key)) ?? null;
}
