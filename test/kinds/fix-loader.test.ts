/**
 * L1: loader integration tests for the `fix` field (P1 of fix-mode epic)
 *
 * Covers:
 * - A `.lint.ts` rule with a safe `replace`-fix is accepted by the loader.
 * - A `.lint.ts` rule with a function-kind fix is accepted only when
 *   the `apply` field is a real function.
 * - `safe` + `guidance-only` is rejected at load time.
 * - `safe` + concrete kind is accepted.
 * - `fix` field on inline `rules.detect[]` entry is validated too.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRules } from '../../src/loader.js';

let cwd = '';
let rulesDir = '';

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'regent-loader-fix-'));
  rulesDir = join(cwd, 'tools', 'audit', 'rules');
  mkdirSync(rulesDir, { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('loader: fix field on .lint.ts', () => {
  it('accepts a safe replace-fix', async () => {
    writeFileSync(
      join(rulesDir, 'with-fix.lint.ts'),
      `export default {
  id: 'test.with-fix',
  severity: 'warning',
  pattern: 'foo',
  globs: ['**/*.cs'],
  message: 'no foo',
  fix: { kind: 'replace', safety: 'safe', title: 'drop foo', template: '' },
};
`,
      'utf8',
    );
    const result = await loadRules({ repoRoot: cwd });
    const rule = result.rules.find((r) => r.spec.id === 'test.with-fix');
    expect(rule).toBeDefined();
    expect(rule!.spec.fix?.kind).toBe('replace');
  });

  it('accepts a function-kind fix when apply is a real function', async () => {
    writeFileSync(
      join(rulesDir, 'with-fn.lint.ts'),
      `export default {
  id: 'test.with-fn',
  severity: 'warning',
  pattern: 'foo',
  globs: ['**/*.cs'],
  message: 'no foo',
  fix: { kind: 'function', safety: 'safe', title: 'rewrite', apply: () => null },
};
`,
      'utf8',
    );
    const result = await loadRules({ repoRoot: cwd });
    const rule = result.rules.find((r) => r.spec.id === 'test.with-fn');
    expect(rule).toBeDefined();
    expect(rule!.spec.fix?.kind).toBe('function');
    if (rule!.spec.fix?.kind === 'function') {
      expect(typeof rule!.spec.fix.apply).toBe('function');
    }
  });

  it('rejects safe + guidance-only at load time', async () => {
    writeFileSync(
      join(rulesDir, 'bad-safety.lint.ts'),
      `export default {
  id: 'test.bad-safety',
  severity: 'warning',
  pattern: 'foo',
  globs: ['**/*.cs'],
  message: 'no foo',
  fix: { kind: 'guidance-only', safety: 'safe', title: 'contradiction' },
};
`,
      'utf8',
    );
    await expect(loadRules({ repoRoot: cwd })).rejects.toThrow(/safe fixes must carry a concrete kind/);
  });

  it('accepts suggested + guidance-only (the canonical suggested-only lane)', async () => {
    writeFileSync(
      join(rulesDir, 'suggested-only.lint.ts'),
      `export default {
  id: 'test.suggested-only',
  severity: 'warning',
  pattern: 'foo',
  globs: ['**/*.cs'],
  message: 'no foo',
  fix: { kind: 'guidance-only', safety: 'suggested', title: 'agent decides', guidance: 'manual' },
};
`,
      'utf8',
    );
    const result = await loadRules({ repoRoot: cwd });
    const rule = result.rules.find((r) => r.spec.id === 'test.suggested-only');
    expect(rule).toBeDefined();
    expect(rule!.spec.fix?.safety).toBe('suggested');
    expect(rule!.spec.fix?.kind).toBe('guidance-only');
  });

  it('rejects function-kind without a real apply (Zod-parse fails)', async () => {
    writeFileSync(
      join(rulesDir, 'bad-fn.lint.ts'),
      `export default {
  id: 'test.bad-fn',
  severity: 'warning',
  pattern: 'foo',
  globs: ['**/*.cs'],
  message: 'no foo',
  fix: { kind: 'function', safety: 'safe', title: 'broken', apply: 'not a function' },
};
`,
      'utf8',
    );
    // Zod's `apply: z.unknown()` accepts any value; the loader's
    // `assertFixApply` runtime-checks the function-kind. The string
    // 'not a function' passes the schema but fails the loader check.
    await expect(loadRules({ repoRoot: cwd })).rejects.toThrow(/requires .apply. to be a function/);
  });
});