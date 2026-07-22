/**
 * L1: project-marker auto-detect. The loader scans `cwd` for
 * language markers (`*.sln`, `package.json`, `Cargo.toml`,
 * `go.mod`, `pyproject.toml`, `setup.py`, `requirements.txt`)
 * and emits an informational hint to stderr when a marker is
 * present but no spec is registered for the corresponding
 * language. Hints never become findings, never bump the exit
 * code.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  autodetectHints,
  detectProjectMarkers,
  suggestSpecsForMarkers,
} from '../../src/loader/autodetect.js';

let DIR = '';
let SAVED_ENV: string | undefined;

beforeEach(() => {
  DIR = join(tmpdir(), `regent-autodetect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(DIR, { recursive: true });
  SAVED_ENV = process.env['STBL_REGENT_AUTODETECT'];
  delete process.env['STBL_REGENT_AUTODETECT'];
});

afterEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  if (SAVED_ENV === undefined) {
    delete process.env['STBL_REGENT_AUTODETECT'];
  } else {
    process.env['STBL_REGENT_AUTODETECT'] = SAVED_ENV;
  }
});

describe('detectProjectMarkers', () => {
  it('returns empty for an empty directory', () => {
    expect(detectProjectMarkers(DIR)).toEqual([]);
  });

  it('detects a .sln (glob expansion)', () => {
    writeFileSync(join(DIR, 'MyApp.sln'), '');
    const markers = detectProjectMarkers(DIR);
    expect(markers.map((m) => m.language)).toContain('dotnet');
  });

  it('detects package.json (exact match)', () => {
    writeFileSync(join(DIR, 'package.json'), '{}');
    const markers = detectProjectMarkers(DIR);
    expect(markers.map((m) => m.language)).toContain('node');
  });

  it('detects multiple languages independently', () => {
    writeFileSync(join(DIR, 'Cargo.toml'), '');
    writeFileSync(join(DIR, 'go.mod'), '');
    const markers = detectProjectMarkers(DIR);
    const langs = markers.map((m) => m.language);
    expect(langs).toContain('rust');
    expect(langs).toContain('go');
  });

  it('detects python via either pyproject.toml, setup.py, or requirements.txt', () => {
    writeFileSync(join(DIR, 'requirements.txt'), '');
    const markers = detectProjectMarkers(DIR);
    expect(markers.map((m) => m.language)).toContain('python');
  });
});

describe('suggestSpecsForMarkers', () => {
  it('suggests a bundle when no matching spec is registered', () => {
    writeFileSync(join(DIR, 'MyApp.sln'), '');
    const markers = detectProjectMarkers(DIR);
    const suggestions = suggestSpecsForMarkers(markers, [], []);
    expect(suggestions.map((s) => s.language)).toContain('dotnet');
    expect(suggestions.find((s) => s.language === 'dotnet')!.bundleId).toBe(
      '@scope/regent-format-dotnet',
    );
  });

  it('does NOT suggest when a matching prefix is already registered', () => {
    writeFileSync(join(DIR, 'MyApp.sln'), '');
    const markers = detectProjectMarkers(DIR);
    // A spec id that starts with 'dotnet.' satisfies the dotnet hint.
    const suggestions = suggestSpecsForMarkers(
      markers,
      [{ id: 'dotnet.style', severity: 'warning', params: { parse: (v) => v ?? {} },
         detect: () => [], normalize: () => [] }],
      [],
    );
    expect(suggestions.map((s) => s.language)).not.toContain('dotnet');
  });

  it('honours explicit `disable` for the bundle id', () => {
    writeFileSync(join(DIR, 'MyApp.sln'), '');
    const markers = detectProjectMarkers(DIR);
    const suggestions = suggestSpecsForMarkers(markers, [], [], ['dotnet']);
    expect(suggestions.map((s) => s.language)).not.toContain('dotnet');
  });
});

describe('autodetectHints', () => {
  it('returns empty when no markers are present', () => {
    const hints = autodetectHints(DIR, [], []);
    expect(hints).toEqual([]);
  });

  it('returns a one-line hint when a marker is detected and no spec is registered', () => {
    writeFileSync(join(DIR, 'package.json'), '{}');
    const hints = autodetectHints(DIR, [], []);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toMatch(/\[regent\]/);
    expect(hints[0]).toMatch(/eslint/i);
  });

  it('respects STBL_REGENT_AUTODETECT=off', () => {
    writeFileSync(join(DIR, 'package.json'), '{}');
    process.env['STBL_REGENT_AUTODETECT'] = 'off';
    expect(autodetectHints(DIR, [], [])).toEqual([]);
  });
});
