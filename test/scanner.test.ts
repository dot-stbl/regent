/**
 * L0: scanner interface + matcher isolation. The Rust-ready shape
 * is verified by exercising the public contract.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TsFileScanner,
  tryFindRegentCore,
  type FileScanner,
} from '../src/core/scanner.js';
import {
  scanFileWithMatcher,
  compileMatcher,
} from '../src/core/scanner-matcher.js';

describe('TsFileScanner', () => {
  it('discovers files matching include globs', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'regent-scanner-'));
    try {
      writeFileSync(join(tmp, 'a.cs'), '');
      writeFileSync(join(tmp, 'b.txt'), '');
      writeFileSync(join(tmp, 'c.cs'), '');
      const scanner: FileScanner = new TsFileScanner();
      const files = await scanner.discover(tmp, ['**/*.cs'], []);
      // tinyglobby returns forward-slash paths on Windows; normalise
      // for comparison.
      const normalise = (p: string) => p.split(/[\\/]/).join('/');
      expect(files.map(normalise).sort()).toEqual([
        normalise(join(tmp, 'a.cs')),
        normalise(join(tmp, 'c.cs')),
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('read returns content for readable files', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'regent-scanner-'));
    try {
      const path = join(tmp, 'a.cs');
      writeFileSync(path, 'hello');
      const scanner = new TsFileScanner();
      const content = await scanner.read(path, 1024);
      expect(content).toBe('hello');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('read returns null for oversized files', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'regent-scanner-'));
    try {
      const path = join(tmp, 'big.cs');
      writeFileSync(path, 'x'.repeat(2048));
      const scanner = new TsFileScanner();
      const content = await scanner.read(path, 1024);
      expect(content).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('read returns null for missing files', async () => {
    const scanner = new TsFileScanner();
    const content = await scanner.read('/does/not/exist/file.cs', 1024);
    expect(content).toBeNull();
  });
});

describe('tryFindRegentCore', () => {
  it('returns null in v0.2 (no Rust binary shipped)', async () => {
    expect(await tryFindRegentCore()).toBeNull();
  });
});

describe('scanFileWithMatcher', () => {
  it('returns an empty list when no line matches', async () => {
    const matcher = await compileMatcher('foo', undefined);
    expect(scanFileWithMatcher(matcher, 'bar\nbaz\n')).toEqual([]);
  });

  it('returns one match per matching line', async () => {
    const matcher = await compileMatcher('foo', undefined);
    const matches = scanFileWithMatcher(matcher, 'foo\nbar\nfoo\n');
    expect(matches).toHaveLength(2);
    expect(matches[0]!.lineIndex).toBe(0);
    expect(matches[1]!.lineIndex).toBe(2);
  });

  it('skips lines that also match the exclude matcher', async () => {
    const matcher = await compileMatcher('foo', 'foo\\s+skip');
    const matches = scanFileWithMatcher(matcher, 'foo\nfoo skip\nfoo\n');
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.lineIndex)).toEqual([0, 2]);
  });

  it('records byte offsets relative to the file start', async () => {
    const matcher = await compileMatcher('foo', undefined);
    const matches = scanFileWithMatcher(matcher, 'bar\nfoo\nbaz\n');
    // 'bar\n' = 4 bytes, 'foo' starts at offset 4.
    expect(matches[0]!.byteOffsetStart).toBe(4);
    expect(matches[0]!.byteOffsetEnd).toBe(7);
  });
});