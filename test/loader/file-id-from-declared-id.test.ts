/**
 * Regression: rule id comes from the rule's declared `id` field, not
 * the filename. The anlytra convention namespaces on-disk files by
 * the project language (e.g. `csharp.csharp.async.no-configureawait.lint.ts`),
 * but the rule author still owns the `id` and writes it without
 * the doubled prefix (`csharp.async.no-configureawait`). The loader
 * MUST honor the declared id; a regression that derived the id
 * from the filename would surface as `csharp.csharp.async.no-configureawait`
 * in `regent list` and break every SARIF / accept-list lookup.
 *
 * The pre-existing `test/ast-file-discovery.test.ts` covers the
 * happy-path case (declared id differs from filename) but doesn't
 * pin the tripled-prefix shape that the anlytra convention
 * produces. This file adds the named regression so the doubled-
 * prefix shape can't sneak back in via a future refactor.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadRules } from '../../src/loader.js';
import { defineAstRule } from '../../src/index.js';
import { defineDetectRule } from '../../src/kinds/detect.js';

const DIR = join(tmpdir(), `regent-declared-id-${Date.now()}`);
const RULES = join(DIR, 'tools', 'audit', 'rules');

beforeAll(() => {
  mkdirSync(RULES, { recursive: true });

  // Detect rule: filename has the doubled `csharp.csharp.` prefix
  // (anlytra convention); declared id has the single `csharp.`
  // prefix. The loaded rule id MUST be the declared id.
  writeFileSync(
    join(RULES, 'csharp.csharp.code-shape.no-private-static-method.lint.ts'),
    `export default {
  id: 'csharp.code-shape.no-private-static-method',
  severity: 'error',
  pattern: 'private static',
  globs: ['**/*.cs'],
  message: 'no private static methods',
};`,
  );

  // AST rule with the same shape: doubled filename prefix, single
  // declared id prefix.
  writeFileSync(
    join(RULES, 'csharp.csharp.async.no-configureawait.lint.ts'),
    `export default {
  id: 'csharp.async.no-configureawait',
  language: 'csharp',
  severity: 'error',
  globs: ['**/*.cs'],
  ast: { rule: { kind: 'invocation_expression' } },
  message: 'no ConfigureAwait',
};`,
  );

  // A third rule: tripled prefix in the filename, single declared
  // id. Belt and braces — covers any path that might incorrectly
  // walk or stack the filename.
  writeFileSync(
    join(RULES, 'csharp.csharp.csharp.naming.no-banned-abbrevs.lint.ts'),
    `export default {
  id: 'csharp.naming.no-banned-abbrevs',
  severity: 'warning',
  pattern: 'ct',
  globs: ['**/*.cs'],
  message: 'no banned abbrevs',
};`,
  );
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe('rule id is the declared id, not the filename', () => {
  it('loads a detect rule with the declared id (filename has doubled csharp.csharp. prefix)', async () => {
    const loaded = await loadRules({ repoRoot: DIR, skipLocal: true });
    const rule = loaded.rules.find(
      (r) => r.spec.id === 'csharp.code-shape.no-private-static-method',
    );
    expect(rule).toBeDefined();
    // And the file-derived id must NOT be present — guards against a
    // regression that would surface a `csharp.csharp.code-shape.no-private-static-method`
    // entry in `regent list`.
    expect(
      loaded.rules.some(
        (r) => r.spec.id === 'csharp.csharp.code-shape.no-private-static-method',
      ),
    ).toBe(false);
  });

  it('loads an ast rule with the declared id (filename has doubled csharp.csharp. prefix)', async () => {
    const loaded = await loadRules({ repoRoot: DIR, skipLocal: true });
    const rule = loaded.astRules.find(
      (r) => r.spec.id === 'csharp.async.no-configureawait',
    );
    expect(rule).toBeDefined();
    expect(
      loaded.astRules.some(
        (r) => r.spec.id === 'csharp.csharp.async.no-configureawait',
      ),
    ).toBe(false);
  });

  it('handles a tripled prefix in the filename (declared id is single-prefix)', async () => {
    const loaded = await loadRules({ repoRoot: DIR, skipLocal: true });
    const rule = loaded.rules.find(
      (r) => r.spec.id === 'csharp.naming.no-banned-abbrevs',
    );
    expect(rule).toBeDefined();
    // The tripled-prefix shape must NOT leak into the loaded id.
    expect(
      loaded.rules.some(
        (r) => r.spec.id === 'csharp.csharp.csharp.naming.no-banned-abbrevs',
      ),
    ).toBe(false);
  });

  it('exposes the source path (file provenance) without confusing it with the id', async () => {
    const loaded = await loadRules({ repoRoot: DIR, skipLocal: true });
    const rule = loaded.rules.find(
      (r) => r.spec.id === 'csharp.code-shape.no-private-static-method',
    );
    // Source/path can be the file path (for SARIF `helpUri`); the
    // id is separate. This pins that the two are independent.
    expect(rule).toBeDefined();
    expect(rule!.source).toContain('csharp.csharp.code-shape.no-private-static-method.lint.ts');
    expect(rule!.origin.path).toContain('csharp.csharp.code-shape.no-private-static-method.lint.ts');
  });

  it('defineDetectRule and defineAstRule accept the declared id and surface it as-is', () => {
    const detect = defineDetectRule({
      id: 'csharp.code-shape.no-private-static-method',
      severity: 'error',
      pattern: 'foo',
      globs: ['**/*.cs'],
      message: 'm',
    });
    expect(detect.id).toBe('csharp.code-shape.no-private-static-method');
    const ast = defineAstRule({
      id: 'csharp.async.no-configureawait',
      language: 'csharp',
      severity: 'error',
      globs: ['**/*.cs'],
      ast: { rule: { kind: 'invocation_expression' } },
      message: 'm',
    });
    expect(ast.id).toBe('csharp.async.no-configureawait');
  });
});
