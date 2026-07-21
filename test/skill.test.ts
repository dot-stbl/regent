/**
 * L0: the bundled Claude Code skill exists, ships, and carries the advisor
 * decision framework (prefer native tools; regent for house-rules; one entry).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILL = readFileSync(
  join(import.meta.dirname, '..', 'skills', 'regent', 'SKILL.md'),
  'utf8',
);

describe('regent skill', () => {
  it('has frontmatter with name: regent and a description', () => {
    expect(SKILL.startsWith('---\n')).toBe(true);
    expect(SKILL).toMatch(/\nname: regent\n/);
    expect(SKILL).toMatch(/\ndescription:/);
  });

  it('teaches the native-vs-regent decision (do not over-engineer)', () => {
    expect(SKILL).toMatch(/dotnet format/);
    expect(SKILL).toMatch(/native tool > regent/i);
    expect(SKILL).toMatch(/single entry point/i);
    expect(SKILL).toMatch(/deprecated/i); // regex kind marked deprecated
  });
});
