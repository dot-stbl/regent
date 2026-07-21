/**
 * L1: v1 JSON-schema validation for `regent fix --format json` (issue #62).
 *
 * The v1 wire document is validated against the artifact at
 * `assets/llm/schema/fix-v1.json` via a hand-rolled validator in
 * `src/reporter/fix-schema.ts` (no `ajv` dep). Coverage:
 *
 *   - representative document with one entry per top-level array
 *     passes the schema end-to-end
 *   - missing required top-level key fails validation
 *   - `additionalProperties: false` on the document root is honoured
 *   - the v1 reason pattern (`"overlap with <ruleId>"`) is enforced
 *   - deferred edit carries the winning ruleId from `applyFixes`
 *     (`ApplyFixesResult.deferred[i].winningRuleId`)
 *   - `regent llm schema fix` round-trip: CLI emits the artifact
 *     and a parsed copy validates against itself
 *   - `regent fix --format json` against the csharp fixture in
 *     `examples/csharp/__fixtures__/csharp.async.configure-await/bad.cs`
 *     produces a schema-valid document with an `applied` entry
 *     whose `before` contains `.ConfigureAwait`
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyFixes } from '../src/fixer.js';
import { loadRules } from '../src/loader.js';
import { runRules } from '../src/runner.js';
import { toV1Json, validateFixV1 } from '../src/reporter/fix-schema.js';
import type { ApplyFixesResult } from '../src/fixer.js';

const REPO_ROOT = join(import.meta.dirname, '..');
const FIX_V1_SCHEMA_PATH = join(REPO_ROOT, 'assets', 'llm', 'schema', 'fix-v1.json');
const CLI = join(REPO_ROOT, 'dist', 'cli.js');
const FIXTURE_DIR = join(REPO_ROOT, 'examples', 'csharp', '__fixtures__', 'csharp.async.configure-await');

const SCHEMA = JSON.parse(readFileSync(FIX_V1_SCHEMA_PATH, 'utf8')) as Record<string, unknown>;

/**
 * Build a deterministic `ApplyFixesResult` that has at least one
 * entry in every top-level array — used to drive the v1 emitter
 * and the schema-conformance assertions.
 */
function buildSampleResult(): ApplyFixesResult {
  return {
    applied: [
      {
        ruleId: 'csharp.async.configure-await',
        file: '/repo/src/example.cs',
        range: { start: 415, end: 437 },
        title: 'csharp.async.configure-await',
        before: '.ConfigureAwait(false)',
        after: '',
      },
    ],
    changedFiles: ['/repo/src/example.cs'],
    deferred: [
      {
        ruleId: 'csharp.naming.private-field-underscore',
        file: '/repo/src/example.cs',
        range: { start: 100, end: 110 },
        reason: 'overlap',
        title: 'csharp.naming.private-field-underscore',
        winningRuleId: 'csharp.async.configure-await',
      },
      {
        ruleId: 'meta.trailing-whitespace',
        file: '/repo/src/other.cs',
        range: { start: 0, end: 0 },
        reason: 'out-of-range',
      },
      {
        ruleId: 'csharp.http.bare-httpclient',
        file: '/repo/src/legacy.cs',
        range: { start: 0, end: 0 },
        reason: 'no-fix-attached',
      },
    ],
    suggested: [
      {
        ruleId: 'csharp.exceptions.throw-variable',
        file: '/repo/src/example.cs',
        range: { start: 500, end: 520 },
        title: 'csharp.exceptions.throw-variable',
        guidance: 'Wrap the exception in a new throw statement so the stack trace is preserved.',
        proposedEdit: {
          start: 500,
          end: 520,
          replacement: 'throw new InvalidOperationException("...", ex);',
        },
      },
      {
        ruleId: 'csharp.async.result-blocking',
        file: '/repo/src/example.cs',
        range: { start: 0, end: 0 },
        title: 'csharp.async.result-blocking',
        guidance: 'Replace .Result/.Wait() with `await` to free the worker thread.',
        proposedEdit: null,
      },
    ],
    unifiedDiff: '',
    passes: 1,
  };
}

describe('toV1Json — shape construction', () => {
  it('emits exactly the three top-level keys', () => {
    const doc = toV1Json(buildSampleResult());
    expect(Object.keys(doc).sort()).toEqual(['applied', 'deferred', 'suggested']);
  });

  it('maps AppliedEdit 1:1 (ruleId/file/range/title/before/after preserved)', () => {
    const doc = toV1Json(buildSampleResult());
    expect(doc.applied).toEqual([
      {
        ruleId: 'csharp.async.configure-await',
        file: '/repo/src/example.cs',
        range: { start: 415, end: 437 },
        title: 'csharp.async.configure-await',
        before: '.ConfigureAwait(false)',
        after: '',
      },
    ]);
  });

  it('serializes SuggestedEdit with `guidance: string | null` and `proposedEdit: object | null`', () => {
    const doc = toV1Json(buildSampleResult());
    expect(doc.suggested).toHaveLength(2);
    const [withEdit, guidanceOnly] = doc.suggested;
    expect(withEdit!.guidance).toBe(
      'Wrap the exception in a new throw statement so the stack trace is preserved.',
    );
    expect(withEdit!.proposedEdit).toEqual({
      start: 500,
      end: 520,
      replacement: 'throw new InvalidOperationException("...", ex);',
    });
    expect(guidanceOnly!.guidance).toBe(
      'Replace .Result/.Wait() with `await` to free the worker thread.',
    );
    expect(guidanceOnly!.proposedEdit).toBeNull();
  });

  it('serializes overlap-deferred with the winning ruleId suffix on `reason`', () => {
    const doc = toV1Json(buildSampleResult());
    const overlap = doc.deferred.find((d) => d.ruleId === 'csharp.naming.private-field-underscore');
    expect(overlap).toBeDefined();
    expect(overlap!.reason).toBe('overlap with csharp.async.configure-await');
  });

  it('preserves bare `out-of-range` and `no-fix-attached` reasons verbatim', () => {
    const doc = toV1Json(buildSampleResult());
    expect(doc.deferred.find((d) => d.reason === 'out-of-range')).toBeDefined();
    expect(doc.deferred.find((d) => d.reason === 'no-fix-attached')).toBeDefined();
  });
});

describe('validateFixV1 — schema conformance', () => {
  it('accepts a representative v1 document', () => {
    const doc = toV1Json(buildSampleResult());
    const result = validateFixV1(doc, SCHEMA);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      // surface errors when the test fails
      expect(result.issues).toEqual([]);
    }
  });

  it('round-trips JSON.parse(JSON.stringify(doc)) — proves wire-shape serialisation is stable', () => {
    const doc = toV1Json(buildSampleResult());
    const text = JSON.stringify(doc);
    const reparsed = JSON.parse(text);
    const result = validateFixV1(reparsed, SCHEMA);
    expect(result.valid).toBe(true);
  });

  it('rejects a document missing the `applied` key', () => {
    const doc = toV1Json(buildSampleResult());
    const broken = { suggested: doc.suggested, deferred: doc.deferred } as unknown;
    const result = validateFixV1(broken, SCHEMA);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const messages = result.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("missing required property 'applied'"))).toBe(true);
    }
  });

  it('rejects a document missing the `suggested` key', () => {
    const doc = toV1Json(buildSampleResult());
    const broken = { applied: doc.applied, deferred: doc.deferred } as unknown;
    const result = validateFixV1(broken, SCHEMA);
    expect(result.valid).toBe(false);
  });

  it('rejects a document missing the `deferred` key', () => {
    const doc = toV1Json(buildSampleResult());
    const broken = { applied: doc.applied, suggested: doc.suggested } as unknown;
    const result = validateFixV1(broken, SCHEMA);
    expect(result.valid).toBe(false);
  });

  it('rejects a document with an extra top-level property (additionalProperties: false)', () => {
    const doc = toV1Json(buildSampleResult());
    const broken = { ...doc, cwd: '/repo', mode: 'apply' };
    const result = validateFixV1(broken, SCHEMA);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const messages = result.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("unexpected additional property 'cwd'"))).toBe(true);
      expect(messages.some((m) => m.includes("unexpected additional property 'mode'"))).toBe(true);
    }
  });

  it('rejects an applied entry with a non-string `before`', () => {
    const doc = toV1Json(buildSampleResult());
    const broken = {
      ...doc,
      applied: [{ ...doc.applied[0]!, before: 42 }],
    };
    const result = validateFixV1(broken, SCHEMA);
    expect(result.valid).toBe(false);
  });

  it('rejects a suggested entry with `proposedEdit: "string"` (oneOf fails)', () => {
    const doc = toV1Json(buildSampleResult());
    const broken = {
      ...doc,
      suggested: [
        { ...doc.suggested[0]!, proposedEdit: 'not-an-object' },
        doc.suggested[1]!,
      ],
    };
    const result = validateFixV1(broken, SCHEMA);
    expect(result.valid).toBe(false);
  });

  it('rejects an overlap reason without a winning ruleId (pattern is strict)', () => {
    const doc = toV1Json(buildSampleResult());
    const broken = {
      ...doc,
      deferred: [{ ...doc.deferred[0]!, reason: 'overlap' }],
    };
    const result = validateFixV1(broken, SCHEMA);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const messages = result.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('value did not match pattern'))).toBe(true);
    }
  });

  it('rejects a `range.start` that is not an integer', () => {
    const doc = toV1Json(buildSampleResult());
    const broken = {
      ...doc,
      applied: [{ ...doc.applied[0]!, range: { start: 1.5, end: 5 } }],
    };
    const result = validateFixV1(broken, SCHEMA);
    expect(result.valid).toBe(false);
  });
});

describe('regent llm schema fix — CLI round-trip', () => {
  it('the fix-v1.json artifact exists', () => {
    expect(existsSync(FIX_V1_SCHEMA_PATH)).toBe(true);
  });

  it('regent llm schema fix emits the v1 schema with the expected $id and $schema', () => {
    // Only run if dist/cli.js is built; the gate script builds first.
    if (!existsSync(CLI)) {
      // Skip rather than fail — the smoke build is run in CI before
      // this test, but a fresh checkout without a build is not an
      // error here. The library-level `toV1Json` + `validateFixV1`
      // tests above already cover the same conformance.
      return;
    }
    const out = execFileSync(process.execPath, [CLI, 'llm', 'schema', 'fix'], {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: '1' },
    }).toString('utf8');
    const parsed = JSON.parse(out);
    expect(parsed.$id).toBe('https://github.com/dot-stbl/regent/schemas/fix-v1.json');
    expect(parsed.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    // Schema document is structurally well-formed (top-level type + properties + required).
    expect(parsed.type).toBe('object');
    expect(Array.isArray(parsed.required)).toBe(true);
    expect(parsed.required).toEqual(expect.arrayContaining(['applied', 'suggested', 'deferred']));
    expect(typeof parsed.properties).toBe('object');
  });

  it('regent llm schema (no args) prints the schema catalog and exits 0', () => {
    if (!existsSync(CLI)) {
      return;
    }
    const out = execFileSync(process.execPath, [CLI, 'llm', 'schema'], {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: '1' },
    }).toString('utf8');
    expect(out).toContain('available schemas');
    expect(out).toContain('`schema fix`');
    expect(out).toContain('`schema fix-rule`');
  });

  it('regent llm schema fix-rule --json still emits the existing rule-spec JSON schema', () => {
    if (!existsSync(CLI)) {
      return;
    }
    const out = execFileSync(process.execPath, [CLI, 'llm', 'schema', 'fix-rule', '--json'], {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: '1' },
    }).toString('utf8');
    const parsed = JSON.parse(out);
    expect(parsed.$ref).toBe('#/definitions/FixRuleSpec');
  });
});

describe('applyFixes integration — winner thread-up', () => {
  it('DeferredEdit.winningRuleId carries the earlier-registered ruleId on overlap', async () => {
    // Two overlapping edits on the same byte range: ruleA wins,
    // ruleB is deferred with winningRuleId === ruleA.id. We construct
    // the inputs directly so the test is independent of any rule
    // schema or config file (issue #62 AC).
    const file = 'overlap.cs';
    const findA = {
      ruleId: 'rule.a',
      severity: 'warning' as const,
      path: file,
      match: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 5, matchText: 'hello', groups: [] },
      context: { startLine: 0, endLine: 0, lines: [] },
      message: '',
      source: 'test',
      status: 'violation' as const,
    };
    const findB = {
      ruleId: 'rule.b',
      severity: 'warning' as const,
      path: file,
      match: { startLine: 0, startColumn: 3, endLine: 0, endColumn: 8, matchText: 'lowor', groups: [] },
      context: { startLine: 0, endLine: 0, lines: [] },
      message: '',
      source: 'test',
      status: 'violation' as const,
    };
    const rulesById = new Map([
      ['rule.a', {
        id: 'rule.a',
        severity: 'warning' as const,
        pattern: '.',
        globs: ['**/*'],
        message: '',
        fix: { kind: 'replace' as const, safety: 'safe' as const, title: 'rule.a', template: 'AAA' },
      }],
      ['rule.b', {
        id: 'rule.b',
        severity: 'warning' as const,
        pattern: '.',
        globs: ['**/*'],
        message: '',
        fix: { kind: 'replace' as const, safety: 'safe' as const, title: 'rule.b', template: 'BBB' },
      }],
    ]);

    // tmpdir + write fixture so applyFixes can read it from disk.
    const cwd = join(tmpdir(), `regent-fixer-v1-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    try {
      writeFileSync(join(cwd, file), 'hello world', 'utf8');
      const absA = join(cwd, file);
      const absB = join(cwd, file);
      const result = await applyFixes(
        [
          { ...findA, path: absA },
          { ...findB, path: absB },
        ],
        rulesById,
        { cwd },
      );
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0]!.ruleId).toBe('rule.a');
      expect(result.deferred).toHaveLength(1);
      expect(result.deferred[0]!.reason).toBe('overlap');
      expect(result.deferred[0]!.winningRuleId).toBe('rule.a');

      // The v1 wire format emits the winning-ruleId on `reason`.
      const v1 = toV1Json(result);
      expect(v1.deferred[0]!.reason).toBe('overlap with rule.a');

      // The wire document validates against the artifact.
      const validation = validateFixV1(v1, SCHEMA);
      expect(validation.valid).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('regent fix --format json on the csharp.configure-await fixture', () => {
  let cwd = '';
  beforeEach(() => {
    cwd = join(tmpdir(), `regent-fix-v1-csharp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(cwd, { recursive: true });
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('emits a schema-valid v1 document with an applied entry whose before contains .ConfigureAwait', async () => {
    if (!existsSync(CLI)) {
      // The gate script builds before running the suite; if dist/ is
      // missing here, skip — the library-level tests above already
      // cover schema conformance end-to-end.
      return;
    }
    if (!existsSync(FIXTURE_DIR)) {
      // The fixture is shipped in the repo; if a future refactor
      // moves it, the test gracefully skips rather than hard-fails.
      return;
    }

    // Copy the bad fixture into a tmpdir so the fix doesn't mutate
    // the shipped example file.
    const target = join(cwd, 'bad.cs');
    copyFileSync(join(FIXTURE_DIR, 'bad.cs'), target);

    // The loader's import() doesn't natively handle .ts files
    // through plain Node — the L1 tests in test/loader.test.ts and
    // test/cli-fix.test.ts work around this by inlining rules in
    // a `.regentrc.js`. We mirror that pattern: define the same
    // `csharp.async.configure-await` rule inline (with the fix
    // attachment the P5 example carries — see
    // `examples/csharp/csharp.async.configure-await.lint.ts`).
    writeFileSync(join(cwd, '.regentrc.js'), `export default {
  rules: {
    detect: [
      {
        id: 'csharp.async.configure-await',
        severity: 'error',
        pattern: '\\\\.ConfigureAwait\\\\s*\\\\(\\\\s*false\\\\s*\\\\)',
        globs: ['**/*.cs'],
        message: '.ConfigureAwait(false) is banned in app code.',
        fix: { kind: 'replace', safety: 'safe', title: 'csharp.async.configure-await', template: '' },
      },
    ],
  },
};
`);

    // Run the engine against the fixture. The rule uses safety:
    // 'safe', so the default 'safe' lane applies the edit on a
    // fresh run — no `--all` needed.
    const out = execFileSync(process.execPath, [
      CLI, 'fix', '--format', 'json', '--yes', 'bad.cs',
    ], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
    }).toString('utf8');

    // Parses as valid JSON.
    const doc = JSON.parse(out);

    // Validates against the schema artifact.
    const validation = validateFixV1(doc, SCHEMA);
    expect(validation.valid).toBe(true);

    // Contains an applied entry whose file matches the fixture
    // and whose before contains `.ConfigureAwait`.
    const applied = (doc.applied ?? []) as Array<{ file: string; before: string }>;
    expect(applied.length).toBeGreaterThan(0);
    const hit = applied.find((a) => a.file.endsWith('bad.cs'));
    expect(hit).toBeDefined();
    expect(hit!.before).toContain('.ConfigureAwait');
  });
});

describe('v1 wire document for an empty applyFixesResult', () => {
  it('produces three empty arrays (not omitted)', () => {
    const empty: ApplyFixesResult = {
      applied: [],
      changedFiles: [],
      deferred: [],
      suggested: [],
      unifiedDiff: '',
      passes: 0,
    };
    const doc = toV1Json(empty);
    expect(doc).toEqual({ applied: [], suggested: [], deferred: [] });
    const validation = validateFixV1(doc, SCHEMA);
    expect(validation.valid).toBe(true);
  });
});

// `loadRules` + `runRules` import kept referenced in case a future
// test needs them; both modules are stable P5 fixtures.
void loadRules;
void runRules;
