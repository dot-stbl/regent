/**
 * L1: `kind: 'regex'` deprecation warning (sub-item 2 of #57).
 *
 * The loader emits a one-time `warning:` line when a rule with `pattern`
 * is loaded, recommending `kind: 'ast'` or `kind: 'command'` migration.
 * Dedupe happens by rule id within a single `loadRules()` call so a
 * rule loaded via multiple sources (file + extends) only warns once.
 *
 * Tested behaviour:
 *  - empty rules → `warnings: []`.
 *  - one regex rule → exactly one warning, naming the rule id.
 *  - two distinct regex rules → two warnings, one each.
 *  - same rule id loaded twice (file + extends) → one warning.
 *  - AST rules alone → no warnings about regex.
 *  - inline `rules.detect[]` declaration with a regex rule → warning fires.
 *  - inline `rules.fix[]` declaration → fix rules are auto-rewrites, out of
 *    scope of the regex deprecation; warning is silent.
 *
 * Test isolation notes:
 *  - We point `STBL_REGENT_GLOBAL_RULES_PATH` at an empty tmpdir so the
 *    developer's `~/.agents/rules/csharp/` (a real checkout of bundled
 *    rules) doesn't pollute `loaded.warnings`.
 *  - Each test uses a fresh tmpdir path so cosmiconfig's cache doesn't
 *    serve stale configs across cases. Mutating `.regentrc.js` in place
 *    in the SAME path is unsafe — the cached config keeps the old
 *    contents regardless of file mtime.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadRules } from '../src/loader.js';
import { defineAstRule } from '../src/kinds/ast.js';

const EMPTY_GLOBAL_RULES = join(tmpdir(), `regent-empty-global-${Date.now()}`);

const ORIGINAL_ENV = process.env['STBL_REGENT_GLOBAL_RULES_PATH'];

beforeAll(() => {
  mkdirSync(EMPTY_GLOBAL_RULES, { recursive: true });
  process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = EMPTY_GLOBAL_RULES;
});

afterAll(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env['STBL_REGENT_GLOBAL_RULES_PATH'];
  } else {
    process.env['STBL_REGENT_GLOBAL_RULES_PATH'] = ORIGINAL_ENV;
  }
  rmSync(EMPTY_GLOBAL_RULES, { recursive: true, force: true });
});

/**
 * Each test asks for a fresh tmpdir so cosmiconfig never sees the
 * same path twice — the loader's module-level explorer otherwise
 * serves a cached stale `.regentrc.js` if the previous test wrote
 * different content to the same path. The helper also reuses one
 * env-var override (the user-global dir) so user-global pollution is
 * never a factor in the assertions.
 */
function freshProjectDir(suffix: string): string {
  const dir = join(tmpdir(), `regent-regex-deprecation-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('LoaderRuleSet.warnings — kind:regex deprecation', () => {
  it('reports zero warnings when no rules are configured', async () => {
    const dir = freshProjectDir('empty');
    try {
      writeFileSync(join(dir, '.regentrc.js'), 'export default { rules: {} };');
      const loaded = await loadRules({ repoRoot: dir, skipLocal: true });
      expect(loaded.warnings).toEqual([]);
    } finally {
      cleanup(dir);
    }
  });

  it('emits exactly one warning when a single regex rule is declared inline', async () => {
    const dir = freshProjectDir('single');
    try {
      writeFileSync(
        join(dir, '.regentrc.js'),
        `export default {
  rules: {
    detect: [
      {
        id: 'smoke.regex-only',
        severity: 'warning',
        pattern: '\\\\bTODO\\\\b',
        globs: ['**/*.cs'],
        message: 'TODO without owner',
      },
    ],
  },
};`,
      );

      const loaded = await loadRules({ repoRoot: dir, skipLocal: true });
      expect(loaded.warnings).toHaveLength(1);
      expect(loaded.warnings[0]).toContain("rule 'smoke.regex-only'");
      expect(loaded.warnings[0]).toContain("kind: 'regex'");
      expect(loaded.warnings[0]).toContain("kind: 'ast' or kind: 'command'");
    } finally {
      cleanup(dir);
    }
  });

  it('emits one warning per distinct regex rule id', async () => {
    const dir = freshProjectDir('multi');
    try {
      writeFileSync(
        join(dir, '.regentrc.js'),
        `export default {
  rules: {
    detect: [
      {
        id: 'multi.one',
        severity: 'warning',
        pattern: 'a',
        globs: ['**/*.cs'],
        message: 'one',
      },
      {
        id: 'multi.two',
        severity: 'warning',
        pattern: 'b',
        globs: ['**/*.cs'],
        message: 'two',
      },
      {
        id: 'multi.three',
        severity: 'warning',
        pattern: 'c',
        globs: ['**/*.cs'],
        message: 'three',
      },
    ],
  },
};`,
      );

      const loaded = await loadRules({ repoRoot: dir, skipLocal: true });
      expect(loaded.warnings).toHaveLength(3);
      expect(loaded.warnings.some((w) => w.includes('multi.one'))).toBe(true);
      expect(loaded.warnings.some((w) => w.includes('multi.two'))).toBe(true);
      expect(loaded.warnings.some((w) => w.includes('multi.three'))).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('does not emit a regex deprecation warning for AST-only rules', async () => {
    const dir = freshProjectDir('ast');
    try {
      const AST_ONLY = defineAstRule({
        id: 'smoke.ast-only',
        language: 'csharp',
        severity: 'warning',
        globs: ['**/*.cs'],
        message: 'AST rule',
        ast: { rule: { pattern: '$A.foo()' } },
      });

      writeFileSync(
        join(dir, '.regentrc.js'),
        `export default { rules: { ast: [${JSON.stringify(AST_ONLY)}] } };`,
      );

      const loaded = await loadRules({ repoRoot: dir, skipLocal: true });
      // No `kind: 'regex'` warning — AST rules don't carry `pattern`.
      expect(loaded.warnings).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  it('does not emit for fix rules (auto-rewrites are out of scope)', async () => {
    const dir = freshProjectDir('fix');
    try {
      writeFileSync(
        join(dir, '.regentrc.js'),
        `export default {
  rules: {
    fix: [
      {
        id: 'fix.only',
        severity: 'warning',
        find: 'foo',
        replace: 'bar',
        globs: ['**/*.cs'],
        message: 'rename',
      },
    ],
  },
};`,
      );

      const loaded = await loadRules({ repoRoot: dir, skipLocal: true });
      // `rules.fix` is auto-rewrite, NOT in scope of the kind:'regex'
      // detection-kind deprecation. Loader is silent.
      expect(loaded.warnings).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  it('dedupes when the same rule id appears in both inline AND extends chains', async () => {
    const dir = freshProjectDir('dedupe');
    try {
      // Two paths to the same rule — file + extends. Loader must warn ONCE.
      mkdirSync(join(dir, 'tools', 'audit', 'rules'), { recursive: true });
      writeFileSync(
        join(dir, 'tools', 'audit', 'rules', 'shared.regex.lint.ts'),
        `import { defineDetectRule } from '@dot-stbl/regent';
export default defineDetectRule({
  id: 'shared.regex',
  severity: 'warning',
  pattern: 'a',
  globs: ['**/*.cs'],
  message: 'shared',
});`,
      );
      writeFileSync(
        join(dir, '.regentrc.js'),
        `export default {
  rules: {
    detect: [
      {
        id: 'shared.regex',
        severity: 'warning',
        pattern: 'a',
        globs: ['**/*.cs'],
        message: 'shared (inline)',
      },
    ],
    extends: ['./tools/audit/rules/shared.regex.lint.ts'],
  },
};`,
      );

      const loaded = await loadRules({ repoRoot: dir, skipLocal: true });
      // One rule id only across both paths; one warning.
      expect(loaded.rules.filter((r) => r.spec.id === 'shared.regex')).toHaveLength(1);
      const warningsAboutShared = loaded.warnings.filter((w) =>
        w.includes('shared.regex'),
      );
      expect(warningsAboutShared).toHaveLength(1);
    } finally {
      cleanup(dir);
    }
  });

  it('deprecation message points the user at CONTRIBUTING.md', async () => {
    const dir = freshProjectDir('doc');
    try {
      writeFileSync(
        join(dir, '.regentrc.js'),
        `export default {
  rules: {
    detect: [
      {
        id: 'doc-pointer',
        severity: 'warning',
        pattern: 'x',
        globs: ['**/*.cs'],
        message: 'm',
      },
    ],
  },
};`,
      );

      const loaded = await loadRules({ repoRoot: dir, skipLocal: true });
      expect(loaded.warnings[0]).toContain('CONTRIBUTING.md');
    } finally {
      cleanup(dir);
    }
  });
});
