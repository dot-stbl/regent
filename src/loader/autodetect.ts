// #34c — project-marker auto-detect.
//
// `regent check` scans the repo root for language markers
// (`*.sln`, `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`)
// and, when a marker is present but no spec is registered for the
// corresponding language, emits a one-shot hint to stderr. The hint
// is informational — it does NOT become a finding, does NOT bump the
// exit code, and does NOT participate in the report.
//
// Behaviour:
//   - `*.sln`            → dotnet  → suggest `@scope/regent-format-dotnet`
//   - `package.json`     → node    → suggest `@scope/regent-delegate-eslint`
//                                       (or `@scope/regent-delegate-tsc`)
//   - `Cargo.toml`       → rust    → suggest `@scope/regent-delegate-cargo`
//   - `go.mod`           → go      → suggest `@scope/regent-delegate-golangci`
//   - `pyproject.toml`   → python  → suggest `@scope/regent-delegate-ruff`
//
// "Configured" means: a spec whose `id` is one of the auto-detect
// hint ids (e.g. `dotnet.whitespace`, `eslint.security`) is
// registered in `loadedRules.formatSpecs` / `delegateSpecs`. We match
// by prefix — `dotnet.*` covers the whole dotnet bundle, `eslint.*`
// covers the eslint bundle, etc.
//
// The hint is suppressed when:
//   - the language marker is absent (no `.sln` → no dotnet hint);
//   - a matching spec is already registered;
//   - `STBL_REGENT_AUTODETECT=off` is set (escape hatch for CI /
//     scripted runs that want stable stderr);
//   - the loaded rule set has a `disable` entry for the suggested
//     bundle id (e.g. user disabled dotnet on purpose).

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { z } from 'zod';

import type { DelegateRuleSpec } from '../kinds/delegate.js';
import type { FormatRuleSpec } from '../kinds/format.js';

/** Languages regent knows about — keep in sync with `src/bundles/`. */
export type ProjectLanguage =
  | 'dotnet'
  | 'node'
  | 'rust'
  | 'go'
  | 'python';

export interface ProjectMarker {
  readonly language: ProjectLanguage;
  /** Absolute path of the marker file (or the file itself). */
  readonly marker: string;
}

/**
 * Suggested bundle id + a one-line explanation. The hint id matches
 * the prefix the loader expects when checking whether the user has
 * already configured the language (see `matchedByPrefix` below).
 */
export interface AutoDetectSuggestion {
  readonly language: ProjectLanguage;
  readonly bundleId: string;
  readonly hintId: string;
  readonly message: string;
}

interface LanguageSpec {
  readonly language: ProjectLanguage;
  /** Marker files (any one of them = language detected). */
  readonly markers: readonly string[];
  readonly hintId: string;
  readonly bundleId: string;
  readonly message: string;
}

/**
 * The list is intentionally hard-coded — auto-detect must not reach
 * for the bundle registry at scan time. New languages ship as both
 * a marker entry here AND a bundle; the two are coupled at the
 * `bundles/` layer, not here.
 */
const LANGUAGE_SPECS: readonly LanguageSpec[] = [
  {
    language: 'dotnet',
    markers: ['*.sln'],
    hintId: 'dotnet.',
    bundleId: '@scope/regent-format-dotnet',
    message:
      'detected a .NET solution — consider extending from '
      + "'@scope/regent-format-dotnet' for dotnet format coverage",
  },
  {
    language: 'node',
    markers: ['package.json'],
    hintId: 'eslint.',
    bundleId: '@scope/regent-delegate-eslint',
    message:
      'detected a Node project — consider extending from '
      + "'@scope/regent-delegate-eslint' for ESLint coverage",
  },
  {
    language: 'rust',
    markers: ['Cargo.toml'],
    hintId: 'cargo.',
    bundleId: '@scope/regent-delegate-cargo',
    message:
      "detected a Rust project — consider extending from "
      + "'@scope/regent-delegate-cargo' for cargo check coverage",
  },
  {
    language: 'go',
    markers: ['go.mod'],
    hintId: 'golangci.',
    bundleId: '@scope/regent-delegate-golangci',
    message:
      'detected a Go module — consider extending from '
      + "'@scope/regent-delegate-golangci' for golangci-lint coverage",
  },
  {
    language: 'python',
    markers: ['pyproject.toml', 'setup.py', 'requirements.txt'],
    hintId: 'ruff.',
    bundleId: '@scope/regent-delegate-ruff',
    message:
      'detected a Python project — consider extending from '
      + "'@scope/regent-delegate-ruff' for ruff check coverage",
  },
];

/**
 * `tinyglobby` sync API — `globSync` — anchored at this module's URL.
 * Same trick as `plugin-extends.ts`: ESM doesn't expose `require`,
 * so we mint a sync `require` from `import.meta.url` via
 * `createRequire`. This keeps `detectProjectMarkers` synchronous
 * (the CLI calls it inline from the `runCheck` warm-up path).
 */
const requireTinyglobby = createRequire(
  pathToFileURL(fileURLToPath(import.meta.url)),
) as NodeRequire;

/**
 * Glob-expand a marker entry against `cwd`. Only `*.sln` needs
 * expansion (a repo can have multiple solutions); the others are
 * exact file names. Returns the absolute path of the first match,
 * or `null` if no marker is present.
 */
function findMarker(cwd: string, marker: string): string | null {
  if (marker.includes('*')) {
    // tinyglobby is already a dep — use it for the glob expansion.
    // Lazy-load via the sync `require` so auto-detect stays
    // synchronous (the CLI calls it inline from the warm-up path).
    const tg = requireTinyglobby('tinyglobby') as typeof import('tinyglobby');
    const matches = tg.globSync(marker, { cwd, onlyFiles: true, absolute: true });
    return matches.length > 0 ? (matches[0] as string) : null;
  }
  const abs = join(cwd, marker);
  return existsSync(abs) ? abs : null;
}

/**
 * Scan `cwd` for known project markers. Returns one entry per
 * detected language; multiple solutions in the same repo collapse
 * to a single dotnet entry (the first match wins for the hint path,
 * but the detection itself is the boolean we care about).
 */
export function detectProjectMarkers(cwd: string): readonly ProjectMarker[] {
  const out: ProjectMarker[] = [];
  const seen = new Set<ProjectLanguage>();
  for (const spec of LANGUAGE_SPECS) {
    if (seen.has(spec.language)) {
      continue;
    }
    for (const marker of spec.markers) {
      const found = findMarker(cwd, marker);
      if (found !== null) {
        out.push({ language: spec.language, marker: found });
        seen.add(spec.language);
        break;
      }
    }
  }
  return out;
}

/**
 * Filter the marker list down to suggestions: a marker becomes a
 * suggestion when no spec with the matching `hintId` prefix is
 * registered. Caller (the CLI) emits the suggestion's `message` to
 * stderr as a one-shot hint.
 *
 * The check is by `id` prefix — `dotnet.*` covers every dotnet
 * spec the bundle ships. Inline-config or file-discovered specs both
 * count; the loader has already merged them into
 * `loadedRules.formatSpecs` / `delegateSpecs` by the time this runs.
 */
export function suggestSpecsForMarkers(
  markers: readonly ProjectMarker[],
  formatSpecs: readonly FormatRuleSpec<z.ZodTypeAny>[],
  delegateSpecs: readonly DelegateRuleSpec<z.ZodTypeAny>[],
  disabledIds: readonly string[] = [],
): readonly AutoDetectSuggestion[] {
  const out: AutoDetectSuggestion[] = [];
  const registeredIds = new Set<string>([
    ...formatSpecs.map((s) => s.id),
    ...delegateSpecs.map((s) => s.id),
  ]);
  for (const marker of markers) {
    const spec = LANGUAGE_SPECS.find((s) => s.language === marker.language);
    if (spec === undefined) {
      continue;
    }
    const matched = [...registeredIds].some((id) => id.startsWith(spec.hintId));
    if (matched) {
      continue;
    }
    // Honour explicit `disable: ['dotnet.*']` even though no spec
    // is registered — the user has made their intent clear.
    if (disabledIds.some((id) => id === spec.hintId.slice(0, -1))) {
      continue;
    }
    out.push({
      language: spec.language,
      bundleId: spec.bundleId,
      hintId: spec.hintId,
      message: spec.message,
    });
  }
  return out;
}

/**
 * Convenience wrapper used by `src/cli.ts`: detect markers in `cwd`,
 * compute suggestions against the loaded spec set, return the
 * message strings (one per suggestion). Returns `[]` when:
 *   - `STBL_REGENT_AUTODETECT=off` is set;
 *   - no markers are present;
 *   - every detected language has a matching spec registered.
 */
export function autodetectHints(
  cwd: string,
  formatSpecs: readonly FormatRuleSpec<z.ZodTypeAny>[],
  delegateSpecs: readonly DelegateRuleSpec<z.ZodTypeAny>[],
  disabledIds: readonly string[] = [],
): readonly string[] {
  if (process.env['STBL_REGENT_AUTODETECT'] === 'off') {
    return [];
  }
  const markers = detectProjectMarkers(cwd);
  if (markers.length === 0) {
    return [];
  }
  return suggestSpecsForMarkers(markers, formatSpecs, delegateSpecs, disabledIds).map(
    (s) => `[regent] ${s.message}`,
  );
}

// Used in tests for the LANGUAGE_SPECS lookup without exporting the
// whole array — keeps the bundle id / marker list private to this
// module while letting the test suite assert exact match strings.
export const __testOnly = {
  findMarker,
};
