/**
 * Snapshot tests for the fix engine's v1 wire document.
 *
 * Issue #63 (P6 of the fix-mode epic, #7). Each fixture under
 * `test/__fixtures__/fix-snapshots/<name>/` pins one representative
 * scenario of `applyFixes` so an accidental schema drift fails the
 * build before it ships. The v1 contract is enforced by:
 *
 *   1. A hand-rolled deep-equal between the engine's `toV1Json` output
 *      and the on-disk `expected.json` per fixture.
 *   2. Path normalisation — `<cwd>` replaces the tmpdir prefix so the
 *      committed `expected.json` doesn't carry absolute paths from a
 *      single host's `$TMPDIR`.
 *   3. A file-on-disk assertion (via `expected.txt`) for non-dry-run
 *      fixtures — catches "engine claims to apply but doesn't write"
 *      regressions that the JSON alone would miss.
 *
 * Adding a new snapshot:
 *   1. Create `test/__fixtures__/fix-snapshots/<name>/`.
 *   2. Add `in.ts` (representative input) and `rules.ts`
 *      (exports `rules: RuleSpec[]` and `buildFindings(content, filePath)`).
 *   3. Run with `REGENT_UPDATE_SNAPSHOTS=1 bun test test/fix-snapshots.test.ts`.
 *   4. Inspect the generated `expected.json` and `expected.txt` — verify
 *      the on-disk content matches what the engine claims to apply.
 *   5. Commit all four files. Subsequent runs validate against the
 *      committed snapshots WITHOUT the env var.
 *
 * When to update snapshots:
 *   - Intentional behaviour change that you can defend in a PR review
 *     (a schema bump from v1 → v2, a new field on `applied`).
 *   - The diff in the failing test makes the change obvious.
 *
 * When NOT to update snapshots:
 *   - Silent regressions — first investigate WHY the diff appeared.
 *     If the new shape isn't documented as intended, fix the engine
 *     or the rule, not the snapshot.
 *
 * Env var: `REGENT_UPDATE_SNAPSHOTS=1` rewrites `expected.json` and
 * `expected.txt` (for non-dry-run fixtures) with the engine's actual
 * output. Set the env var ONLY when authoring a new fixture or
 * intentionally bumping the wire format — never as a blanket
 * "make the test pass" escape hatch.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyFixes, type ApplyFixesOptions, type ApplyFixesResult } from '../src/fixer.js';
import { toV1Json, type FixV1Document } from '../src/reporter/fix-schema.js';
import type { Finding, RuleSpec } from '../src/types.js';

const FIXTURES_ROOT = join(import.meta.dirname, '__fixtures__', 'fix-snapshots');
const TMP_PREFIX = join(tmpdir(), 'regent-fix-snap-');
const UPDATE_ENV = 'REGENT_UPDATE_SNAPSHOTS';
/** Placeholder substituted for the per-run tmpdir in fixture paths. */
const PATH_PLACEHOLDER = '<cwd>';

interface FixtureRulesModule {
  readonly rules: readonly RuleSpec[];
  readonly buildFindings: (content: string, filePath: string) => readonly Finding[];
}

interface LoadedFixture {
  readonly name: string;
  readonly dir: string;
  readonly inContent: string;
  readonly module: FixtureRulesModule;
}

/**
 * Hand-rolled deep-equal. Returns `true` for primitives and recursive
 * equality on objects/arrays. `undefined` is treated as missing on
 * objects (mirrors `JSON.stringify` semantics — `expected.json` never
 * contains explicit `undefined`).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) {
    return a === b;
  }
  if (typeof a !== 'object') {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(b)) {
    return false;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao).sort();
  const bKeys = Object.keys(bo).sort();
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) {
      return false;
    }
    if (!deepEqual(ao[aKeys[i]!], bo[bKeys[i]!])) {
      return false;
    }
  }
  return true;
}

/**
 * Build a human-readable diff between two values. Lists which keys
 * differ (added / removed / mismatched) so a failing assertion shows
 * the snapshot reviewer exactly which field drifted.
 */
function describeDiff(expected: unknown, actual: unknown, path = ''): string[] {
  const lines: string[] = [];
  if (expected === actual) {
    return lines;
  }
  if (typeof expected !== typeof actual) {
    lines.push(
      `${path || '(root)'}: type mismatch — expected ${typeof expected}, got ${typeof actual}`,
    );
    return lines;
  }
  if (expected === null || actual === null || typeof expected !== 'object') {
    lines.push(`${path || '(root)'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return lines;
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    lines.push(`${path || '(root)'}: one is array, other is not`);
    return lines;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      lines.push(`${path || '(root)'}: length mismatch — expected ${expected.length}, got ${actual.length}`);
    }
    const len = Math.min(expected.length, actual.length);
    for (let i = 0; i < len; i++) {
      lines.push(...describeDiff(expected[i], actual[i], `${path}/${i}`));
    }
    return lines;
  }
  const eo = expected as Record<string, unknown>;
  const ao = actual as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(eo), ...Object.keys(ao)]);
  for (const key of [...allKeys].sort()) {
    if (!(key in eo)) {
      lines.push(`${path}/${key}: unexpected additional property (got ${JSON.stringify(ao[key])})`);
    } else if (!(key in ao)) {
      lines.push(`${path}/${key}: missing property (expected ${JSON.stringify(eo[key])})`);
    } else {
      lines.push(...describeDiff(eo[key], ao[key], `${path}/${key}`));
    }
  }
  return lines;
}

/**
 * Walk a v1 document and replace the tmpdir prefix in every string
 * field with `<cwd>`. The committed `expected.json` uses `<cwd>` so
 * the snapshot doesn't bake in a single host's `$TMPDIR` value.
 *
 * Only `file` fields carry paths in the v1 schema, but we walk every
 * string for robustness against future field additions.
 */
function normalisePathsInDoc(doc: FixV1Document, cwd: string): unknown {
  const cwdNorm = cwd.replace(/\\/g, '/');
  function walk(value: unknown): unknown {
    if (typeof value === 'string') {
      if (value === cwdNorm || value === cwd) {
        return PATH_PLACEHOLDER;
      }
      if (value.startsWith(`${cwdNorm}/`)) {
        return `${PATH_PLACEHOLDER}/${value.slice(cwdNorm.length + 1)}`;
      }
      if (value.startsWith(`${cwd}\\`)) {
        return `${PATH_PLACEHOLDER}/${value.slice(cwd.length + 1)}`;
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = walk(v);
      }
      return out;
    }
    return value;
  }
  return walk(doc);
}

/**
 * Strip the leading whitespace and trailing newline from `JSON.stringify`'s
 * output so the on-disk `expected.json` matches the convention used by
 * `regent fix --format json` (two-space indent, trailing newline).
 */
function serialiseDoc(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

async function loadFixture(name: string): Promise<LoadedFixture> {
  const dir = join(FIXTURES_ROOT, name);
  const rulesPath = join(dir, 'rules.ts');
  if (!existsSync(rulesPath)) {
    throw new Error(`fixture ${name} is missing rules.ts at ${rulesPath}`);
  }
  const inPath = join(dir, 'in.ts');
  if (!existsSync(inPath)) {
    throw new Error(`fixture ${name} is missing in.ts at ${inPath}`);
  }
  const url = pathToFileURL(rulesPath).href;
  const module = (await import(url)) as FixtureRulesModule;
  if (!Array.isArray(module.rules)) {
    throw new Error(`fixture ${name}: rules.ts must export \`rules: readonly RuleSpec[]\``);
  }
  if (typeof module.buildFindings !== 'function') {
    throw new Error(
      `fixture ${name}: rules.ts must export \`buildFindings(content, filePath): Finding[]\``,
    );
  }
  return {
    name,
    dir,
    inContent: readFileSync(inPath, 'utf8'),
    module,
  };
}

interface FixtureRun {
  readonly result: ApplyFixesResult;
  readonly normalisedDoc: unknown;
  readonly filePath: string;
  readonly onDiskContent: string;
}

async function runFixture(fixture: LoadedFixture, cwd: string): Promise<FixtureRun> {
  const filePath = join(cwd, 'in.ts');
  writeFileSync(filePath, fixture.inContent, 'utf8');
  const findings = fixture.module.buildFindings(fixture.inContent, filePath);
  const rulesById = new Map<string, RuleSpec>(
    fixture.module.rules.map((rule) => [rule.id, rule]),
  );
  const options: ApplyFixesOptions = { cwd };
  const result = await applyFixes(findings, rulesById, options);
  const doc = toV1Json(result);
  const normalisedDoc = normalisePathsInDoc(doc, cwd);
  const onDiskContent = readFileSync(filePath, 'utf8');
  return { result, normalisedDoc, filePath, onDiskContent };
}

function listFixtureDirs(): string[] {
  if (!existsSync(FIXTURES_ROOT)) {
    return [];
  }
  return readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('__'))
    .sort();
}

describe('fix-snapshots — golden output tests for applyFixes (P6, #63)', () => {
  let cwd = '';
  let shouldUpdate = false;

  beforeEach(() => {
    cwd = mkdtempSync(TMP_PREFIX);
    shouldUpdate = process.env[UPDATE_ENV] === '1';
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  for (const name of listFixtureDirs()) {
    it(`fixture: ${name}`, async () => {
      const fixture = await loadFixture(name);
      const run = await runFixture(fixture, cwd);

      const expectedPath = join(fixture.dir, 'expected.json');
      const expectedTextPath = join(fixture.dir, 'expected.txt');

      if (shouldUpdate) {
        mkdirSync(fixture.dir, { recursive: true });
        writeFileSync(expectedPath, serialiseDoc(run.normalisedDoc), 'utf8');
        // Only write expected.txt for non-dry-run fixtures. Dry-run
        // fixtures have no on-disk side-effect to assert.
        writeFileSync(expectedTextPath, run.onDiskContent, 'utf8');
        return;
      }

      if (!existsSync(expectedPath)) {
        throw new Error(
          `fixture ${name}: missing expected.json — run with ${UPDATE_ENV}=1 to generate`,
        );
      }
      const expectedDoc = JSON.parse(readFileSync(expectedPath, 'utf8'));
      const diffs = describeDiff(expectedDoc, run.normalisedDoc);
      expect(diffs, `snapshot mismatch for fixture ${name}:\n${diffs.join('\n')}`).toEqual([]);
      expect(deepEqual(expectedDoc, run.normalisedDoc), 'deep-equal sanity check').toBe(true);

      // File-on-disk side-effect assertion — catches the
      // "engine claims to apply but doesn't write" class of
      // regressions. `expected.txt` is generated alongside
      // `expected.json`; dry-run fixtures carry the unmodified
      // `in.ts` content.
      if (!existsSync(expectedTextPath)) {
        throw new Error(
          `fixture ${name}: missing expected.txt — run with ${UPDATE_ENV}=1 to generate`,
        );
      }
      const expectedText = readFileSync(expectedTextPath, 'utf8');
      expect(run.onDiskContent, `on-disk content mismatch for fixture ${name}`).toBe(expectedText);
    });
  }
});

/**
 * Negative-case fixtures are directories whose names start with `__`.
 * They live under `__fixtures__/fix-snapshots/` like the regular
 * fixtures but are NOT auto-discovered by `listFixtureDirs()` — the
 * runner picks them up here and asserts that the snapshot comparison
 * FAILS for each (proving the schema constraint is enforced).
 */
describe('fix-snapshots — negative-case schema enforcement (P6, #63)', () => {
  let cwd = '';
  beforeEach(() => {
    cwd = mkdtempSync(TMP_PREFIX);
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('a fixture whose expected.json carries an extra top-level key (e.g. cwd) is rejected', async () => {
    const fixtureName = '__negative-extra-key';
    const fixture = await loadFixture(fixtureName);
    const run = await runFixture(fixture, cwd);

    const expectedPath = join(fixture.dir, 'expected.json');
    if (!existsSync(expectedPath)) {
      throw new Error(
        `negative fixture ${fixtureName}: missing expected.json — the fixture should ship a deliberately-broken shape`,
      );
    }
    const expectedDoc = JSON.parse(readFileSync(expectedPath, 'utf8'));

    // Pre-condition: the fixture's expected.json MUST contain an
    // extra top-level key — otherwise it's not exercising the
    // negative path.
    const expectedKeys = Object.keys(expectedDoc as Record<string, unknown>);
    const actualKeys = Object.keys(run.normalisedDoc as Record<string, unknown>);
    const extraKeys = expectedKeys.filter((k) => !actualKeys.includes(k));
    expect(
      extraKeys.length,
      `negative fixture ${fixtureName}: expected an extra top-level key in expected.json but found none — the negative fixture is broken`,
    ).toBeGreaterThan(0);

    // The deep-equal MUST fail for this fixture, and the diff MUST
    // name the extra key. The runner above refuses to write the
    // extra key (toV1Json strips it), so the equality check below
    // documents the same constraint at the unit-test layer.
    const isEqual = deepEqual(expectedDoc, run.normalisedDoc);
    expect(isEqual, `expected deep-equal to FAIL for ${fixtureName}`).toBe(false);

    const diffs = describeDiff(expectedDoc, run.normalisedDoc);
    const diffText = diffs.join('\n');
    for (const extraKey of extraKeys) {
      expect(
        diffText.includes(extraKey),
        `diff should mention the extra top-level key '${extraKey}' — got:\n${diffText}`,
      ).toBe(true);
    }
  });
});
