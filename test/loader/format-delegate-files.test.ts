/**
 * L1: format / delegate spec file discovery — a `*.format.ts` /
 * `*.delegate.ts` file under `tools/audit/` (one level up from
 * `tools/audit/rules/`) is picked up into `LoaderRuleSet.formatSpecs`
 * / `delegateSpecs`. Disable filter applies; severity overrides
 * apply; inline-config entries win over file-discovered entries
 * (the user can shadow without rewriting the file).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadRules } from '../../src/loader.js';
import {
  loadDelegateSpecFilesUnder,
  loadFormatSpecFilesUnder,
} from '../../src/loader/format-delegate-files.js';
import type { DelegateRuleSpec } from '../../src/kinds/delegate.js';
import type { FormatRuleSpec } from '../../src/kinds/format.js';
import { defineDelegate } from '../../src/kinds/delegate.js';
import { defineFormat } from '../../src/kinds/format.js';
import { z } from 'zod';

// Discovery tests share one DIR; pipeline-integration tests each
// get their OWN dir because Node's ESM loader caches by URL —
// rewriting `.regentrc.js` in-place between tests returns the
// previously-imported module. A fresh cwd per test gives each test
// a unique `.regentrc.js` URL, busting the cache.
let DIR = '';
let SPECS = '';

beforeAll(() => {
  DIR = join(tmpdir(), `regent-fd-discovery-${Date.now()}`);
  SPECS = join(DIR, 'tools', 'audit');
  mkdirSync(SPECS, { recursive: true });

  writeFileSync(
    join(SPECS, 'dotnet.whitespace.format.ts'),
    `export default {
  id: 'dotnet.whitespace',
  severity: 'warning',
  params: { parse: (v) => v ?? {} },
  detect: () => ['dotnet', 'format', '.', '--verify-no-changes'],
  fix: () => ['dotnet', 'format', '.'],
  normalize: () => [],
};`,
  );

  writeFileSync(
    join(SPECS, 'eslint.security.delegate.ts'),
    `export default {
  id: 'eslint.security',
  severity: 'error',
  params: { parse: (v) => v ?? {} },
  detect: () => ['eslint', '--format', 'json', 'src'],
  normalize: () => [],
};`,
  );

  // A file that exports something but NOT a spec shape — must be
  // silently skipped, not crash the loader.
  writeFileSync(
    join(SPECS, 'helpers.format.ts'),
    `export const utils = { greeting: 'hi' };`,
  );
});

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/**
 * For pipeline-integration tests that need a `.regentrc.js`,
 * mint a fresh dir per test. See the comment on the shared
 * `DIR` constant for why a shared dir doesn't work.
 */
function freshDir(label: string): { dir: string; specs: string; cleanup: () => void } {
  const dir = join(tmpdir(), `regent-fd-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const specs = join(dir, 'tools', 'audit');
  mkdirSync(specs, { recursive: true });
  for (const name of ['dotnet.whitespace.format.ts', 'eslint.security.delegate.ts']) {
    writeFileSync(
      join(specs, name),
      name.startsWith('dotnet')
        ? `export default {
  id: 'dotnet.whitespace',
  severity: 'warning',
  params: { parse: (v) => v ?? {} },
  detect: () => ['dotnet', 'format', '.', '--verify-no-changes'],
  fix: () => ['dotnet', 'format', '.'],
  normalize: () => [],
};`
        : `export default {
  id: 'eslint.security',
  severity: 'error',
  params: { parse: (v) => v ?? {} },
  detect: () => ['eslint', '--format', 'json', 'src'],
  normalize: () => [],
};`,
    );
  }
  return { dir, specs, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('loadFormatSpecFilesUnder', () => {
  it('discovers *.format.ts files and skips non-spec exports', async () => {
    const result = await loadFormatSpecFilesUnder(SPECS);
    const ids = result.map((entry) => entry.spec.id);
    expect(ids).toContain('dotnet.whitespace');
    expect(ids).not.toContain('helpers');
  });

  it('returns [] for a non-existent root', async () => {
    const result = await loadFormatSpecFilesUnder(join(DIR, 'does-not-exist'));
    expect(result).toEqual([]);
  });

  it('emits a sibling .md as source when present', async () => {
    // Loader convention: strip `.format.ts` → `<base>.md`. The .md
    // path is paired with the spec by basename, NOT by extension-
    // preserving name (same as the `.lint.ts` / `.lint.md` pairing
    // in `loader.ts`).
    const tsPath = join(SPECS, 'docs.format.ts');
    const mdPath = join(SPECS, 'docs.md');
    writeFileSync(mdPath, '# docs\n\nThe dotnet whitespace spec ships with a doc.');
    writeFileSync(
      tsPath,
      `export default {
  id: 'docs.spec',
  severity: 'warning',
  params: { parse: (v) => v ?? {} },
  detect: () => ['echo', 'docs'],
  normalize: () => [],
};`,
    );
    const result = await loadFormatSpecFilesUnder(SPECS);
    const docs = result.find((entry) => entry.spec.id === 'docs.spec');
    expect(docs).toBeDefined();
    // The spec file's own `source` field, when set, wins over the
    // auto-derived sibling .md. The test's spec doesn't set `source`,
    // so the loader falls back to the sibling .md path.
    expect(docs!.meta.source).toMatch(/\.md$/);
  });
});

describe('loadDelegateSpecFilesUnder', () => {
  it('discovers *.delegate.ts files', async () => {
    const result = await loadDelegateSpecFilesUnder(SPECS);
    const ids = result.map((entry) => entry.spec.id);
    expect(ids).toContain('eslint.security');
  });
});

describe('loader pipeline integration', () => {
  it('file-discovered format/delegate specs land in LoaderRuleSet', async () => {
    const loaded = await loadRules({ repoRoot: DIR, skipLocal: true });
    const formatIds = loaded.formatSpecs.map((s) => s.id);
    const delegateIds = loaded.delegateSpecs.map((s) => s.id);
    expect(formatIds).toContain('dotnet.whitespace');
    expect(delegateIds).toContain('eslint.security');
  });

  it('disable filter removes format/delegate specs by id', async () => {
    const ctx = freshDir('disable');
    try {
      writeFileSync(
        join(ctx.dir, '.regentrc.js'),
        `export default { rules: { disable: ['dotnet.whitespace', 'eslint.security'] } };`,
      );
      const loaded = await loadRules({ repoRoot: ctx.dir, skipLocal: true });
      const formatIds = loaded.formatSpecs.map((s) => s.id);
      const delegateIds = loaded.delegateSpecs.map((s) => s.id);
      expect(formatIds).not.toContain('dotnet.whitespace');
      expect(delegateIds).not.toContain('eslint.security');
    } finally {
      ctx.cleanup();
    }
  });

  it('severity override applies to format/delegate specs', async () => {
    const ctx = freshDir('override');
    try {
      writeFileSync(
        join(ctx.dir, '.regentrc.js'),
        `export default {
  rules: { override: {
    'dotnet.whitespace': { severity: 'error' },
    'eslint.security': { severity: 'warning' },
  } },
};`,
      );
      const loaded = await loadRules({ repoRoot: ctx.dir, skipLocal: true });
      const formatSpec = loaded.formatSpecs.find((s) => s.id === 'dotnet.whitespace');
      const delegateSpec = loaded.delegateSpecs.find((s) => s.id === 'eslint.security');
      expect(formatSpec?.severity).toBe('error');
      expect(delegateSpec?.severity).toBe('warning');
    } finally {
      ctx.cleanup();
    }
  });

  it('inline config entry wins over file-discovered spec (same id)', async () => {
    const ctx = freshDir('inline-wins');
    try {
      writeFileSync(
        join(ctx.dir, '.regentrc.js'),
        `export default {
  rules: {
    format: [{
      id: 'dotnet.whitespace',
      severity: 'error',
      params: { parse: (v) => v ?? {} },
      detect: () => ['dotnet', 'format', '.', '--verify-no-changes'],
      normalize: () => [],
    }],
  },
};`,
      );
      const loaded = await loadRules({ repoRoot: ctx.dir, skipLocal: true });
      const matched = loaded.formatSpecs.filter((s) => s.id === 'dotnet.whitespace');
      expect(matched).toHaveLength(1);
      // Inline severity `error` replaces the file-discovered `warning`.
      expect(matched[0]!.severity).toBe('error');
    } finally {
      ctx.cleanup();
    }
  });
});

describe('type predicates', () => {
  it('isFormatRuleSpec accepts a defineFormat export and rejects non-spec', async () => {
    const good: FormatRuleSpec<z.ZodTypeAny> = defineFormat({
      id: 'x', severity: 'warning',
      params: z.object({}),
      detect: () => ['echo'],
      normalize: () => [],
    });
    const { __testOnly } = await import('../../src/loader/format-delegate-files.js');
    expect(__testOnly.isFormatRuleSpec(good)).toBe(true);
    expect(__testOnly.isFormatRuleSpec({ id: 'y' })).toBe(false);
    expect(__testOnly.isFormatRuleSpec(null)).toBe(false);
    expect(__testOnly.isFormatRuleSpec('not an object')).toBe(false);
  });

  it('isDelegateRuleSpec accepts a defineDelegate export and rejects non-spec', async () => {
    const good: DelegateRuleSpec<z.ZodTypeAny> = defineDelegate({
      id: 'x', severity: 'warning',
      params: z.object({}),
      detect: () => ['echo'],
      normalize: () => [],
    });
    const { __testOnly } = await import('../../src/loader/format-delegate-files.js');
    expect(__testOnly.isDelegateRuleSpec(good)).toBe(true);
    expect(__testOnly.isDelegateRuleSpec({ id: 'y', normalize: 'nope' })).toBe(false);
  });
});
