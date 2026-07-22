// Rust-ready interface for the file scanner.
//
// `regent` ships a TypeScript implementation (the default). A future
// v0.4+ `regent-core` Rust binary can implement the same interface
// and replace the TS implementation with zero changes to the runner
// contract. Detection is via the `regent-core` binary in PATH.
//
// This file is the contract. The runner consumes a `FileScanner` —
// either the default TS implementation or a future Rust-backed one.

import { readFile } from 'node:fs/promises';

import { DEFAULT_EXCLUDE_PATHS } from './scanner-defaults.js';
import { scanFileWithMatcher, type CompiledMatcher } from './scanner-matcher.js';

/**
 * Contract for everything that walks the filesystem for regent. The
 * default implementation (`TsFileScanner`) lives in this file; a
 * future Rust-backed `regent-core` binary implements the same interface
 * so the runner can swap implementations without code changes.
 */
export interface FileScanner {
  /**
   * Discover files under `root` matching `includeGlobs` and not
   * matching `excludeGlobs`. Returns absolute paths.
   */
  discover(
    root: string,
    includeGlobs: readonly string[],
    excludeGlobs: readonly string[],
  ): Promise<string[]>;

  /**
   * Read a single file. Returns `null` when the file is missing,
   * unreadable, or exceeds the per-file size cap.
   */
  read(path: string, maxBytes: number): Promise<string | null>;
}

/**
 * Default TypeScript implementation. Uses `tinyglobby` for
 * `discover` and `node:fs/promises` for `read`. O(N) over files
 * for the read step; concurrency is handled by the runner.
 */
export class TsFileScanner implements FileScanner {
  async discover(
    root: string,
    includeGlobs: readonly string[],
    excludeGlobs: readonly string[],
  ): Promise<string[]> {
    const { glob } = await import('tinyglobby');
    return glob([...includeGlobs], {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      ignore: excludeGlobs.length > 0 ? [...excludeGlobs] : [...DEFAULT_EXCLUDE_PATHS],
    });
  }

  async read(path: string, maxBytes: number): Promise<string | null> {
    try {
      const buf = await readFile(path);
      if (buf.byteLength > maxBytes) {
        return null;
      }
      return buf.toString('utf8');
    } catch {
      return null;
    }
  }
}

/**
 * Detect-and-report entry point. Scans a single file against one
 * compiled matcher and returns the raw match lines (or empty).
 * Kept separate from `FileScanner` so the matcher + offset-extraction
 * logic can be shared by the runner regardless of how files are read.
 */
export { scanFileWithMatcher, type CompiledMatcher };

/**
 * Auto-detect a `regent-core` binary in PATH. If present, a future
 * v0.4+ could use it. v0.2 always returns null (TS impl only).
 *
 * The interface is exposed so the runner can be wired to call the
 * Rust binary when present without changing the call shape.
 */
export async function tryFindRegentCore(): Promise<string | null> {
  // v0.2: no Rust binary shipped. The runner uses TsFileScanner
  // unconditionally. The detection hook exists so Phase 4+ can
  // plug in without touching the runner.
  return null;
}