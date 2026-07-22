/**
 * L2: shipped-example fixture tests for v0.2 + v1 fix mode (P9, #66).
 *
 * Each shipped example in `examples/<lang>/` should have a fixture
 * pair in `examples/<lang>/__fixtures__/<rule>/{bad,good}.{ext}`.
 * This test enumerates the available fixtures and runs each one
 * against the corresponding rule.
 *
 * v0.2: only csharp has fixtures. New languages' fixtures are added
 * with the rule.
 *
 * v1 fix-mode (P9, #66): every shipped rule whose `fix` attachment is
 * present ALSO carries a `fixed.<ext>` triple, and that file MUST
 * equal the literal `regent fix` output against `bad.<ext>`. This
 * catches drift between the rule and the published expected output.
 * `fixed.<ext>` is engine output, NOT human-cleaned — `good.<ext>`
 * may legitimately differ.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runRules } from '../src/runner.js';
import type { CompiledRule, RuleSpec } from '../src/types.js';

const REPO_ROOT = join(import.meta.dirname, '..');
const EXAMPLES_DIR = join(REPO_ROOT, 'examples');
const FIXTURES_DIR = join(EXAMPLES_DIR, 'csharp', '__fixtures__');
const CLI = join(REPO_ROOT, 'dist', 'cli.js');

interface FixturePair {
  readonly ruleId: string;
  readonly bad: string;
  readonly good: string;
  readonly ext: string;
}

function loadFixtures(): FixturePair[] {
  if (!existsSync(FIXTURES_DIR)) {
    return [];
  }
  const out: FixturePair[] = [];
  for (const dirName of readdirSync(FIXTURES_DIR)) {
    const dir = join(FIXTURES_DIR, dirName);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    const badCs = join(dir, 'bad.cs');
    const goodCs = join(dir, 'good.cs');
    if (existsSync(badCs) && existsSync(goodCs)) {
      out.push({
        ruleId: dirName,
        bad: readFileSync(badCs, 'utf8'),
        good: readFileSync(goodCs, 'utf8'),
        ext: 'cs',
      });
    }
  }
  return out;
}

async function loadExampleRule(ruleId: string): Promise<RuleSpec> {
  const path = join(EXAMPLES_DIR, 'csharp', `${ruleId}.lint.ts`);
  const url = new URL(`file://${path.replace(/\\/g, '/')}`).href;
  const mod = (await import(url)) as { default: RuleSpec };
  return mod.default;
}

async function runRuleOnText(
  spec: RuleSpec,
  text: string,
  fileName: string,
): Promise<number> {
  // For testing, we just call runRules directly with a single rule.
  // The runner's "file" mode reads from disk; here we use a more
  // direct approach via a synthetic RunnerScope.
  void fileName;
  // Use the public runner API by writing to a tempdir — simpler than
  // mocking the file reader.
  const tmp = mkdtempSync(join(tmpdir(), 'regent-fixture-test-'));
  try {
    const filePath = join(tmp, fileName);
    writeFileSync(filePath, text);
    const rule: CompiledRule = {
      spec,
      source: '<test>',
      origin: { kind: 'repo', path: tmp },
    };
    const result = await runRules([rule], {
      cwd: tmp,
      includeGlobs: [fileName],
      excludeGlobs: [],
      changedOnly: false,
      diffBase: 'HEAD',
    });
    return result.findings.length;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Run `regent fix` against `badText` in a scratch tmpdir that has the
 * rule's `.lint.ts` file copied into `tools/audit/rules/`. Returns
 * the on-disk file content after the engine runs.
 *
 * Mirrors the steps in CONTRIBUTING.md "Adding a `fixed.<ext>` to your
 * fixture": copy `bad.<ext>`, copy the rule, run `regent fix --yes
 * --unsafe` (the function-form fix on `csharp.exceptions.brace-style`
 * requires the unsafe lane; safe-lane edits apply identically with or
 * without the flag, so the engine output is stable).
 *
 * The tmpdir is cleaned up regardless of outcome.
 */
function runRegentFixOnText(
  ruleId: string,
  badText: string,
  ext: string,
): string {
  const tmp = mkdtempSync(join(tmpdir(), 'regent-fix-fixture-'));
  try {
    const fileName = `bad.${ext}`;
    writeFileSync(join(tmp, fileName), badText, 'utf8');
    mkdirSync(join(tmp, 'tools', 'audit', 'rules'), { recursive: true });
    copyFileSync(
      join(EXAMPLES_DIR, 'csharp', `${ruleId}.lint.ts`),
      join(tmp, 'tools', 'audit', 'rules', `${ruleId}.lint.ts`),
    );
    // The example rule file imports `@dot-stbl/regent`. The node
    // loader resolves bare specifiers through node_modules — without
    // a local link to the package the rule's `import` statement
    // throws and the rule is silently dropped by the loader's
    // try/catch (resulting in "no fixable findings"). Mirror the
    // published layout by writing a minimal package.json +
    // symlinking the in-tree package into node_modules/@dot-stbl/.
    writeFileSync(
      join(tmp, 'package.json'),
      `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
      'utf8',
    );
    mkdirSync(join(tmp, 'node_modules', '@dot-stbl'), { recursive: true });
    symlinkSync(REPO_ROOT, join(tmp, 'node_modules', '@dot-stbl', 'regent'), 'dir');
    const r = spawnSync(
      process.execPath,
      [CLI, 'fix', '--yes', '--unsafe'],
      {
        cwd: tmp,
        env: { ...process.env, NO_COLOR: '1' },
      },
    );
    if (r.status !== 0) {
      throw new Error(
        `regent fix failed for ${ruleId} (exit ${r.status}): stdout=${r.stdout?.toString() ?? ''} stderr=${r.stderr?.toString() ?? ''}`,
      );
    }
    return readFileSync(join(tmp, fileName), 'utf8');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe('shipped csharp example fixtures', () => {
  const fixtures = loadFixtures();

  it('discovers at least 7 csharp fixture pairs', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(7);
  });

  for (const f of fixtures) {
    it(`${f.ruleId}: bad.cs fires at least one finding`, async () => {
      const spec = await loadExampleRule(f.ruleId);
      const findings = await runRuleOnText(spec, f.bad, 'bad.cs');
      expect(findings, `${f.ruleId} should match bad.cs`).toBeGreaterThan(0);
    });

    it(`${f.ruleId}: good.cs produces zero findings`, async () => {
      const spec = await loadExampleRule(f.ruleId);
      const findings = await runRuleOnText(spec, f.good, 'good.cs');
      expect(findings, `${f.ruleId} should NOT match good.cs`).toBe(0);
    });
  }
});

/**
 * v1 fix-mode (P9, #66): for every shipped rule that ships a `fix`
 * attachment, `examples/csharp/__fixtures__/<rule>/fixed.<ext>` MUST
 * exist and MUST equal the literal `regent fix` output against
 * `bad.<ext>`.
 *
 * Detect-only rules (no `fix` attachment) short-circuit inside the
 * per-rule check (early return) — the triple-extension is only
 * meaningful for fixable rules.
 *
 * IMPORTANT: this test does NOT assert `fixed.<ext>` equals
 * `good.<ext>`. Those can legitimately differ — `good.<ext>` is the
 * human-cleaned final shape, `fixed.<ext>` is the literal mechanical
 * output. See CONTRIBUTING.md "Adding a `fixed.<ext>` to your
 * fixture" for the rationale.
 */
describe('shipped csharp fixable fixtures (v1 fix-mode, P9 #66)', () => {
  const fixtures = loadFixtures();

  it('discovers the shipped fixable csharp fixtures', async () => {
    // P9 ships with two fixable csharp rules: csharp.async.configure-await +
    // csharp.exceptions.brace-style. If new fixable rules land, this
    // count moves up — keep it in sync with the shipped rule set.
    const fixable: string[] = [];
    for (const f of fixtures) {
      const spec = await loadExampleRule(f.ruleId);
      if (spec.fix !== undefined) {
        fixable.push(f.ruleId);
      }
    }
    expect(fixable.length).toBeGreaterThanOrEqual(2);
  });

  for (const f of fixtures) {
    it(`${f.ruleId}: fixed.cs equals regent fix output (fixable only)`, async () => {
      const spec = await loadExampleRule(f.ruleId);
      if (spec.fix === undefined) {
        // Detect-only rule — skip without failing the test.
        return;
      }
      const fixedPath = join(FIXTURES_DIR, f.ruleId, `fixed.${f.ext}`);
      expect(
        existsSync(fixedPath),
        `${f.ruleId} ships a fix but is missing __fixtures__/${f.ruleId}/fixed.${f.ext}`,
      ).toBe(true);

      const onDisk = readFileSync(fixedPath, 'utf8');
      const engineOutput = runRegentFixOnText(f.ruleId, f.bad, f.ext);

      // The shipped file must equal the engine output BYTE-FOR-BYTE.
      // If they drift, regenerate the file (CONTRIBUTING.md
      // "Adding a `fixed.<ext>` to your fixture").
      expect(
        onDisk,
        `${f.ruleId}/fixed.${f.ext} does not equal current regent fix output — regenerate via CONTRIBUTING.md`,
      ).toBe(engineOutput);
    });
  }
});
