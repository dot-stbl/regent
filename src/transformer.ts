/**
 * Transform pipeline (issue #25).
 *
 * Runs `transform(filePath, content) → string` for each registered
 * transform rule whose globs match the file. Last-rule-wins on
 * conflicts: rules apply in registration order (file-discovered
 * rules win on id over inline rules, mirroring the detect/fix
 * merge semantics).
 *
 * The runner invokes this AFTER detect (and after fix, when #59
 * lands). Detect and fix operate on in-memory content; transform
 * runs on the post-fix content per #25's pipeline order
 * ("detect → fix → transform"). Until fix is wired (#59), this
 * function operates on the original file content.
 *
 * Per-rule contract (see `src/kinds/transform.ts`):
 *   `transform(filePath, content) → string`
 *   - MUST be pure + deterministic.
 *   - Returning `null` declines (currently typed as `string`; null
 *     declined path is reserved for #7 P7 function-fixes).
 *
 * If multiple transform rules apply to the same file, they run in
 * registration order and each receives the previous rule's output
 * as its `content` argument. The final string is returned.
 */

import type { CompiledTransformRule } from './kinds/transform.js';

export interface RunTransformsOptions {
  readonly cwd: string;
  /** Absolute paths to transform; runner provides this list. */
  readonly files: readonly string[];
  readonly transformRules: readonly CompiledTransformRule[];
}

export interface TransformResult {
  /** Absolute path of the file that was transformed. */
  readonly file: string;
  /** Original content as read from disk. */
  readonly originalContent: string;
  /** Content after applying all matching transform rules. */
  readonly transformedContent: string;
  /** Rule ids whose transform actually ran on this file. */
  readonly appliedRuleIds: readonly string[];
}

export interface RunTransformsOutput {
  readonly results: readonly TransformResult[];
  /** Files that changed (originalContent !== transformedContent). */
  readonly changedFiles: readonly string[];
}

/**
 * Apply all matching transform rules to each file in `opts.files`.
 * Files whose content does not change are still returned (with
 * `appliedRuleIds: []`) so callers can decide whether to write
 * anything. `changedFiles` is the convenient list for the write
 * step.
 */
export async function runTransforms(
  opts: RunTransformsOptions,
): Promise<RunTransformsOutput> {
  const { cwd, files, transformRules } = opts;
  const { readFile } = await import('node:fs/promises');

  const results: TransformResult[] = [];
  const changedFiles: string[] = [];

  for (const file of files) {
    const relPath = toRelative(file, cwd);
    const matching = transformRules.filter((rule) =>
      rule.spec.globs.some((pattern: string) => globMatches(pattern, relPath)),
    );
    if (matching.length === 0) {
      continue;
    }

    const originalContent = await readFile(file, 'utf8');
    let content = originalContent;
    const applied: string[] = [];
    for (const rule of matching) {
      content = rule.spec.transform(file, content);
      applied.push(rule.spec.id);
    }

    results.push({
      file,
      originalContent,
      transformedContent: content,
      appliedRuleIds: applied,
    });
    if (content !== originalContent) {
      changedFiles.push(file);
    }
  }

  return { results, changedFiles };
}

function toRelative(abs: string, cwd: string): string {
  if (abs.startsWith(cwd)) {
    const rel = abs.slice(cwd.length);
    return rel.replace(/^[\\/]/, '');
  }
  return abs;
}

/**
 * Tiny `** /foo / *.ts`-style glob matcher, kept in sync with the
 * runner's `globMatches`. Supports `*` (single-segment) and `**`
 * (any-depth). Does NOT support negation (`!`), character classes
 * (`[abc]`), or brace expansion (`{a,b}`) — the runner's loader
 * normalises patterns before they reach here, so the supported
 * subset is sufficient for rule-file globs.
 */
function globMatches(pattern: string, file: string): boolean {
  return globToRegExp(pattern).test(file);
}

function globToRegExp(glob: string): RegExp {
  let body = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i] ?? '';
    if (c === '*' && glob[i + 1] === '*') {
      body += '.*';
      i += 2;
      if (glob[i] === '/') {
        i++;
      }
    } else if (c === '*') {
      body += '[^/]*';
      i++;
    } else {
      body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${body}$`);
}