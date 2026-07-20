import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProjectConfig } from '../src/config/sources/file.js';

let cwd = '';

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'regent-config-yaml-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('YAML project config', () => {
  it('loads a detect rule from .regentrc.yaml', async () => {
    writeFileSync(
      join(cwd, '.regentrc.yaml'),
      `# Regent YAML config supports comments
rules:
  detect:
    - id: yaml.no-todo
      severity: warning
      pattern: TODO
      globs:
        - "**/*.ts"
      message: no TODO comments
`,
    );

    const config = await loadProjectConfig(cwd);

    expect(config?.rules.detect).toHaveLength(1);
    expect(config?.rules.detect[0]?.id).toBe('yaml.no-todo');
  });

  it('resolves config nested under the regent key', async () => {
    writeFileSync(
      join(cwd, '.regentrc.yaml'),
      `regent:
  rules:
    detect:
      - id: yaml.nested
        severity: error
        pattern: nested
        globs:
          - "**/*.ts"
        message: nested config
`,
    );

    const config = await loadProjectConfig(cwd);

    expect(config?.rules.detect).toHaveLength(1);
    expect(config?.rules.detect[0]?.id).toBe('yaml.nested');
  });

  it('fails fast on unknown keys through Zod strict mode', async () => {
    writeFileSync(join(cwd, '.regentrc.yaml'), 'unknownField: true\n');

    await expect(loadProjectConfig(cwd)).rejects.toThrow(
      /Zod validation failed for YAML config.*unknownField/s,
    );
  });

  it('reports malformed YAML with the config path', async () => {
    writeFileSync(
      join(cwd, '.regentrc.yaml'),
      `rules:
  detect:
    - id: yaml.malformed
      severity: error
     pattern: malformed
`,
    );

    await expect(loadProjectConfig(cwd)).rejects.toThrow(
      /YAML parse failed at .*\.regentrc\.yaml:/s,
    );
  });
});
