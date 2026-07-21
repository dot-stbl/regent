/**
 * L3: issue #16 — `regent example copy` writes a rule file into a
 * consumer project's `tools/audit/rules/`. Historically every shipped
 * `examples/csharp/*.lint.ts` imported `defineRule` from the relative
 * path `'../../src/define-rule.js'`. That path is correct *only inside
 * the regent repo* — after `example copy` lands the file into a
 * consumer project (no `src/`, no `@dot-stbl/regent` resolution from
 * that path), the import was broken.
 *
 * This test reproduces that flow: stand up a fresh fixture project in
 * a tmpdir that links `@dot-stbl/regent` to the *built* `dist/` via
 * a `file:`-protocol dep, copy each shipped example into that fresh
 * project, then dynamically import the copy and run it. The import
 * must succeed (the actual issue #16 fix), and the rule must produce
 * at least one finding against representative content.
 *
 * Fix rules (`*.fix.ts`) are skipped for the findings assertion —
 * they're transform rules, not detect. Their imports still get
 * verified by the same dynamic-import probe.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { examplesDir, findExample } from '../src/examples/index.js';
import { runRules } from '../src/runner.js';
import type { CompiledRule, RuleSpec } from '../src/types.js';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const DIST_DIR = join(PROJECT_ROOT, 'dist');
// The `file:`-protocol dep points at the *package root* (not `dist/`) so
// bun can read `package.json#name` + `main` (which points at `dist/index.js`).
// Tying the dep to `dist/` would skip `package.json` and fail with
// `MissingPackageJSON` (bun hard-fails on dep resolution).
const PACKAGE_FILE_REF = PROJECT_ROOT;

let projectRoot: string;
const toolSuiteRoot = (): string => join(projectRoot, 'tools', 'audit', 'rules');

interface LintFixture {
  readonly ruleId: string;
  readonly language: string;
  readonly fileName: string;
  readonly content: string;
  /** Synthetic input that should match the rule. */
  readonly triggerContent: string;
  readonly triggerFile: string;
}

/**
 * Synthetic content known to trigger each shipped lint rule. The
 * shipped csharp rules also have a `__fixtures__/<rule>/bad.cs` pair
 * — for those we reuse the existing fixture so this test exercises
 * the same content the `shipped-examples.test.ts` L2 suite uses.
 */
const SYNTHETIC_TRIGGERS: Record<string, { content: string; file: string }> = {
  'typescript.no-console': {
    content: `// synth: 'typescript.no-console'\nfunction boot(){ console.log("ready"); }\n`,
    file: 'boot.ts',
  },
  'typescript.no-any': {
    content: `// synth: 'typescript.no-any'\nfunction untyped(x: any): any { return x; }\n`,
    file: 'untyped.ts',
  },
  'python.no-print': {
    content: `# synth: 'python.no-print'\ndef main() -> None:\n    print("ready")\n`,
    file: 'main.py',
  },
  'meta.line-length-120': {
    content: `// synth: 'meta.line-length-120'\nconst padded = "01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890";\n`,
    file: 'padded.ts',
  },
  // also match by short ruleId (the key form `findExample` uses)
  'no-console': {
    content: `// synth: 'typescript.no-console'\nfunction boot(){ console.log("ready"); }\n`,
    file: 'boot.ts',
  },
  'no-throw-any': {
    content: `// synth: 'typescript.no-any'\nfunction untyped(x: any): any { return x; }\n`,
    file: 'untyped.ts',
  },
  'no-print': {
    content: `# synth: 'python.no-print'\ndef main() -> None:\n    print("ready")\n`,
    file: 'main.py',
  },
  'line-length-120': {
    content: `// synth: 'meta.line-length-120'\nconst padded = "01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890";\n`,
    file: 'padded.ts',
  },
};

interface LintRule {
  readonly language: string;
  /** Filename-friendly registry id (e.g. `no-console`). */
  readonly registryId: string;
  /** Full dotted rule id declared inside the rule spec (e.g. `typescript.no-console`). */
  readonly specId: string;
}

const LINT_RULES: readonly LintRule[] = [
  {
    language: 'csharp',
    registryId: 'csharp.exceptions.brace-style',
    specId: 'csharp.exceptions.brace-style',
  },
  {
    language: 'csharp',
    registryId: 'csharp.async.configure-await',
    specId: 'csharp.async.configure-await',
  },
  {
    language: 'csharp',
    registryId: 'csharp.async.discard-assignment',
    specId: 'csharp.async.discard-assignment',
  },
  {
    language: 'csharp',
    registryId: 'csharp.async.getawaiter-blocking',
    specId: 'csharp.async.getawaiter-blocking',
  },
  {
    language: 'csharp',
    registryId: 'csharp.async.result-blocking',
    specId: 'csharp.async.result-blocking',
  },
  {
    language: 'csharp',
    registryId: 'csharp.exceptions.throw-variable',
    specId: 'csharp.exceptions.throw-variable',
  },
  {
    language: 'csharp',
    registryId: 'csharp.http.bare-httpclient',
    specId: 'csharp.http.bare-httpclient',
  },
  {
    language: 'csharp',
    registryId: 'csharp.naming.private-field-underscore',
    specId: 'csharp.naming.private-field-underscore',
  },
  {
    language: 'typescript',
    registryId: 'no-console',
    specId: 'typescript.no-console',
  },
  {
    language: 'typescript',
    registryId: 'no-throw-any',
    specId: 'typescript.no-any',
  },
  { language: 'python', registryId: 'no-print', specId: 'python.no-print' },
  {
    language: 'meta',
    registryId: 'line-length-120',
    specId: 'meta.line-length-120',
  },
];

function resolveFixture(rule: LintRule): LintFixture {
  const path = findExample(examplesDir(), rule.language, rule.registryId);
  if (!path) {
    throw new Error(
      `Example not found: ${rule.language}/${rule.registryId}`,
    );
  }
  const content = readFileSync(path, 'utf8');
  const fixtureDir = join(
    examplesDir(),
    rule.language,
    '__fixtures__',
    rule.registryId,
  );
  const csBad = join(fixtureDir, 'bad.cs');
  const trigger =
    existsSync(csBad) && rule.language === 'csharp'
      ? { content: readFileSync(csBad, 'utf8'), file: 'bad.cs' }
      : SYNTHETIC_TRIGGERS[rule.registryId];
  if (!trigger) {
    throw new Error(`No trigger content for ${rule.registryId}`);
  }
  return {
    ruleId: rule.specId,
    language: rule.language,
    fileName: `${rule.registryId}.lint.ts`,
    content,
    triggerContent: trigger.content,
    triggerFile: trigger.file,
  };
}

describe('regent example copy (issue #16)', () => {
  beforeAll(() => {
    if (!existsSync(DIST_DIR)) {
      throw new Error(
        `dist/ missing at ${DIST_DIR} — run 'bun run build' before this test.`,
      );
    }
    projectRoot = mkdtempSync(join(tmpdir(), 'regent-copy-test-'));
    const packageJson = {
      name: 'fixture',
      version: '0.0.0',
      type: 'module',
      private: true,
      dependencies: {
        '@dot-stbl/regent': `file:${PACKAGE_FILE_REF}`,
      },
    };
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify(packageJson, null, 2),
    );
    mkdirSync(toolSuiteRoot(), { recursive: true });

    // One-shot bun install per suite — caches node_modules in tmpdir.
    const bun = process.platform === 'win32' ? 'bun.cmd' : 'bun';
    const result = spawnSync(bun, ['install', '--silent'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: true,
    });
    if (result.error) {
      throw new Error(
        `bun install spawn failed: ${result.error.message}\n` +
          `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `bun install failed in fixture project (exit ${result.status}):\n` +
          `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
  }, 120_000);

  afterAll(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('findExample resolves a shipped example path', () => {
    const path = findExample(
      examplesDir(),
      'csharp',
      'csharp.async.discard-assignment',
    );
    expect(path).not.toBeNull();
    expect(path!).toMatch(/csharp\.async\.discard-assignment\.lint\.ts$/);
  });

  for (const f of LINT_RULES.map(resolveFixture)) {
    it(`copy of ${f.ruleId} loads in a fresh project and detects content`, async () => {
      // Simulate `regent example copy <lang> <ruleId>`: write the
      // shipped source verbatim into the consumer project's
      // tools/audit/rules/. After this PR, every shipped example
      // imports from '@dot-stbl/regent' — the import must resolve
      // against the fixture project's node_modules/@dot-stbl/regent.
      const dest = join(toolSuiteRoot(), f.fileName);
      writeFileSync(dest, f.content);

      // Dynamic import — must succeed. THIS is the issue #16 invariant.
      const url = pathToFileURL(dest).href;
      const mod = (await import(url)) as { default: RuleSpec };
      expect(mod.default).toBeTruthy();
      expect(mod.default.id).toBe(f.ruleId);

      // Loaded cleanly — run it on representative content.
      const work = join(projectRoot, 'workdir');
      mkdirSync(work, { recursive: true });
      const triggerPath = join(work, f.triggerFile);
      writeFileSync(triggerPath, f.triggerContent);

      const compiled: CompiledRule = {
        spec: mod.default,
        source: '<example-copy>',
        origin: { kind: 'repo', path: work },
      };
      const includeGlob = f.triggerFile.replace(/[\\/]/g, sep);
      const result = await runRules([compiled], {
        cwd: work,
        includeGlobs: [includeGlob],
        excludeGlobs: [],
        changedOnly: false,
        diffBase: 'HEAD',
      });
      expect(
        result.findings.length,
        `${f.ruleId} should detect its synthetic trigger`,
      ).toBeGreaterThan(0);
    }, 30_000);
  }
});
