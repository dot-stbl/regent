// Example registry — index shipped examples for `regent example` CLI.
//
// Examples live at `<package-root>/examples/<lang>/<rule>.lint.ts`.
// They are NOT auto-loaded by regent — agents opt in via
// `regent example copy <lang> <rule-id>` (writes a real rule file
// into a project's `tools/audit/rules/`) or via `extends:` paths
// in their config.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolve the examples directory. Walks up from this module until
 * `examples/` is found — works both in dev (`src/examples/`) and in
 * the published package layout.
 */
export function examplesDir(): string {
  const candidates = [
    join(process.cwd(), 'examples'),
    join(import.meta.dirname ?? __dirname, '..', '..', 'examples'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return candidates[0]!;
}

export interface ExampleEntry {
  readonly language: string;
  readonly ruleId: string;
  readonly path: string;
}

/**
 * List every example under `<examplesDir>/<lang>/*.lint.ts`.
 */
export function listExamples(root: string): ExampleEntry[] {
  if (!existsSync(root)) {
    return [];
  }
  const out: ExampleEntry[] = [];
  for (const lang of readdirSync(root, { withFileTypes: true })) {
    if (!lang.isDirectory()) {
      continue;
    }
    const langDir = join(root, lang.name);
    for (const file of readdirSync(langDir)) {
      if (!file.endsWith('.lint.ts')) {
        continue;
      }
      const ruleId = file.replace(/\.lint\.ts$/, '');
      out.push({
        language: lang.name,
        ruleId,
        path: join(langDir, file),
      });
    }
  }
  return out.sort((a, b) =>
    a.language === b.language
      ? a.ruleId.localeCompare(b.ruleId)
      : a.language.localeCompare(b.language),
  );
}

/**
 * Locate a single example by language + ruleId. Returns null when
 * the example does not exist.
 */
export function findExample(
  root: string,
  language: string,
  ruleId: string,
): string | null {
  const candidate = join(root, language, `${ruleId}.lint.ts`);
  return existsSync(candidate) ? candidate : null;
}