/**
 * L2: shipped-example fixture tests for v0.2.
 *
 * Each shipped example in `examples/<lang>/` should have a fixture
 * pair in `examples/<lang>/__fixtures__/<rule>/{bad,good}.{ext}`.
 * This test enumerates the available fixtures and runs each one
 * against the corresponding rule.
 *
 * v0.2: only csharp has fixtures. New languages' fixtures are added
 * with the rule.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runRules } from '../src/runner.js';
import type { CompiledRule, RuleSpec } from '../src/types.js';

const EXAMPLES_DIR = join(import.meta.dirname, '..', 'examples');
const FIXTURES_DIR = join(EXAMPLES_DIR, 'csharp', '__fixtures__');

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
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
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