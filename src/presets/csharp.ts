/**
 * Default C# rule presets shipped with `@stbl/regent`.
 *
 * Each rule pairs an executable pattern with provenance to a `.md` source.
 * The runner reports `source` so consumers can navigate to the prose
 * explanation via `regent explain <rule-id>`.
 *
 * Adding a new rule requires both the executable here AND a `.md` file
 * in `~/.agents/rules/csharp/` (or a repo-local override).
 *
 * Tri-state review (see `types.ts` §tri-state): rules marked with
 * `review.enabled` produce `status: 'pending'` findings that are
 * surfaced via `regent review` instead of failing CI directly.
 */

import { defineRule } from '../define-rule.js';
import type { RuleSpec } from '../types.js';

/**
 * Reject `#region`/`#endregion` directives. Per BRAND.md §10 of
 * `code-shape.md`, regions hide class bloat and discourage extraction.
 *
 * Pattern: `#region` anchored to start-of-line, with optional leading
 * whitespace. The trailing `\b` (word boundary) catches both bare
 * `#region` and `#region Properties`.
 */
export const noRegion = defineRule({
  id: 'csharp.no-region-directive',
  severity: 'error',
  pattern: '^\\s*#region\\b',
  globs: ['**/*.cs'],
  excludePaths: ['**/*.g.cs', '**/*.Designer.cs', '**/bin/**', '**/obj/**'],
  message: '#region запрещён в C# (code-shape.md §10)',
  source: 'code-shape.md#no-region-directives',
  rationale:
    '`#region` прячет структуру от outline, поощряет раздувание класса, шумит в diff. Класс > 200 строк — сигнал к декомпозиции, не к сворачиванию.',
});

/**
 * Reject `private` methods in production code. Override methods (which
 * carry the `override` keyword) are excepted. See `code-shape.md` §9.
 *
 * Pattern: `private` keyword followed by zero-or-more identifiers, then
 * `(`. Matches `private void Foo()`, `private static async Task Bar()`,
 * and `private int _field` (which is the intended false-positive — but
 * `(_field)` doesn't end in `(` so it slips through). For tighter
 * matching add another rule.
 */
export const noPrivateMethods = defineRule({
  id: 'csharp.no-private-methods',
  severity: 'error',
  pattern: '^\\s*private\\s+(?:static\\s+)?(?:async\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\\s+)+[A-Za-z_][A-Za-z0-9_]*\\s*\\(',
  excludeWhen: '\\boverride\\b',
  globs: ['**/*.cs'],
  excludePaths: [
    '**/Migrations/**',
    '**/bin/**',
    '**/obj/**',
    '**/*.g.cs',
    '**/*.Designer.cs',
  ],
  message: 'no private methods in production code — extract to file-static helper',
  source: 'code-shape.md#no-private-business-logic',
  rationale:
    'private метод — это процедурный код. Вынеси в `file static class`, extension method, или отдельный helper с DI.',
});

/**
 * **Review-mode.** TODO/FIXME comments without owner/ticket reference.
 * Often ok in fresh code; review before merge to confirm ownership.
 *
 * Pattern: any `// TODO` or `// FIXME` line. `excludeWhen` skips lines
 * whose `TODO`/`FIXME` is followed by a parenthetical ticket reference
 * (e.g. `TODO(ANL-200):`). RE2 syntax has no negative-lookahead, so
 * we exclude on a positive match instead.
 */
export const noTodoWithoutOwner = defineRule({
  id: 'csharp.no-todo-without-owner',
  severity: 'warning',
  pattern: '//\\s*(TODO|FIXME)\\b',
  excludeWhen: '//\\s*(TODO|FIXME)\\s*\\(',
  globs: ['**/*.cs'],
  excludePaths: ['**/*.g.cs', '**/bin/**', '**/obj/**', '**/*.Designer.cs'],
  message: 'TODO / FIXME без owner / ticket ref',
  source: 'code-shape.md#todo-without-owner',
  review: {
    enabled: true,
    exitBehavior: 'unreviewed-fails',
    guidance:
      'проверь что у TODO есть owner или ticket (например `TODO(ANL-200):`). Если нет — добавь ticket или `regent accept` с причиной.',
  },
});

/**
 * **Review-mode.** Single-letter variable names outside conventional
 * loop counters (`i`, `j`, `k`). Often ok, but worth a glance for
 * non-loop contexts.
 *
 * Pattern: declaration of `var/let/const` + identifier + single-char
 * name + `;`, `=`, or `(`.
 */
export const shortName = defineRule({
  id: 'csharp.short-name',
  severity: 'suggestion',
  pattern: '^\\s*(private|public|internal|protected)\\s+(?:static\\s+)?(?:readonly\\s+)?[A-Za-z_][A-Za-z0-9_<>?.,\\[\\]\\s]*\\b([a-z])\\s*[;=(]',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**', '**/*.g.cs', '**/*.Designer.cs'],
  message: 'однобуквенное имя переменной вне типичных loop-счётчиков',
  source: 'naming-and-types.md#short-variables',
  review: {
    enabled: true,
    exitBehavior: 'no-fail',
    guidance:
      'однобуквенные имена оправданы в `for (int i)` и подобных loops. В других контекстах — предпочитай `idx`, `count` и т.д.',
  },
});

export const csharpPreset: RuleSpec[] = [
  noRegion,
  noPrivateMethods,
  noTodoWithoutOwner,
  shortName,
];
