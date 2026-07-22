// Composable regex builders for common static-analysis categories.
//
// Why this exists:
//   - RE2 syntax differs from JS regex (no backreferences, no lookbehind,
//     no lookaround). LLM agents writing raw RE2 trip on these.
//   - These builders capture well-tested patterns once, let agents compose
//     higher-level rules without hand-crafting regexes each time.
//
// Usage:
//   import { patterns } from '@dot-stbl/regent/patterns';
//
//   defineDetectRule({
//     id: 'csharp.no-todo-without-owner',
//     pattern: patterns.todoComment()
//       .unlessFollowedBy(patterns.ticketReference())
//       .toRegex(),
//     ...
//   });
//
// Each builder returns a small composable object. `toRegex()` finalises
// the chain into a string suitable for the `pattern` field of a rule.

export interface RegexBuilder {
  /** Anchor the pattern at the start of the line. */
  anchored(): RegexBuilder;
  /** Match the pattern only when followed by the given sub-pattern. */
  unlessFollowedBy(other: string | RegexBuilder): RegexBuilder;
  /** Restrict to word boundary on the right. */
  asWord(): RegexBuilder;
  /** Compile to a RE2 pattern string. */
  toRegex(): string;
}

function compile(parts: string[]): RegexBuilder {
  const source = parts.join('');
  const builder: RegexBuilder & { source: string } = {
    source,
    anchored() {
      return compile(['^', ...parts]);
    },
    unlessFollowedBy(other) {
      const otherStr = typeof other === 'string' ? other : (other as unknown as { source: string }).source;
      return compile([...parts, `(?!${otherStr})`]);
    },
    asWord() {
      return compile([...parts, '\\b']);
    },
    toRegex() {
      return source;
    },
  };
  return builder;
}

/**
 * Pattern namespace — one helper per common rule category.
 */
export const patterns = {
  /**
   * `// TODO`, `// FIXME`, `# TODO`, `# FIXME`, etc.
   * Anchored at start-of-line by default.
   */
  todoComment(): RegexBuilder {
    return compile(['(^|\\s)(//|#)\\s*(TODO|FIXME)\\b']);
  },

  /**
   * Parenthesised ticket reference: `(ANL-1234)`, `(JIRA-200)`, etc.
   * Anchored at start of input.
   */
  ticketReference(): RegexBuilder {
    return compile(['\\([A-Z][A-Z0-9]+-\\d+\\)']);
  },

  /**
   * C# private field with underscore prefix: `private int _foo;`.
   */
  privateUnderscoreField(): RegexBuilder {
    return compile(['^\\s*private\\s+', /[A-Za-z_<>?.,[\]\s]+/.source, '_+\\s*[A-Za-z]\\w*']);
  },

  /**
   * C# `private` method declaration: `private void DoWork()`, etc.
   */
  privateMethod(): RegexBuilder {
    return compile([
      '^\\s*private\\s+(?:static\\s+)?(?:async\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\\s+)+[A-Za-z_][A-Za-z0-9_]*\\s*\\(',
    ]);
  },

  /**
   * `#region` directive (C#). Anchored.
   */
  regionDirective(): RegexBuilder {
    return compile(['#region\\b']);
  },

  /**
   * `throw ex;` (re-throws a captured exception, resets the stack).
   */
  throwVariable(): RegexBuilder {
    return compile(['^\\s*throw\\s+[A-Za-z_]\\w*\\s*;']);
  },

  /**
   * `.Result` accessor on a Task — sync-over-async deadlock risk.
   */
  taskResultAccess(): RegexBuilder {
    return compile(['\\.\\s*Result\\b']);
  },

  /**
   * `.GetAwaiter().GetResult()` chain.
   */
  getAwaiterGetResult(): RegexBuilder {
    return compile(['\\.GetAwaiter\\s*\\(\\s*\\)\\s*\\.GetResult\\s*\\(\\s*\\)']);
  },

  /**
   * `.ConfigureAwait(false)` — banned in app code.
   */
  configureAwaitFalse(): RegexBuilder {
    return compile(['\\.ConfigureAwait\\s*\\(\\s*false\\s*\\)']);
  },

  /**
   * `_ =` discard assignment at statement start.
   */
  discardAssignment(): RegexBuilder {
    return compile(['^\\s*_\\s*=\\s*']);
  },

  /**
   * Bare `new HttpClient(...)` — bypasses IHttpClientFactory.
   */
  bareHttpClient(): RegexBuilder {
    return compile(['\\bnew\\s+HttpClient\\s*\\(']);
  },

  /**
   * `console.log(...)` / `console.error(...)` in TS/JS source.
   */
  consoleLog(): RegexBuilder {
    return compile(['\\bconsole\\.(log|error|warn|info|debug)\\s*\\(']);
  },

  /**
   * `throw new Error(...)` — generic catch-all.
   */
  throwNewError(): RegexBuilder {
    return compile(['throw\\s+new\\s+Error\\s*\\(']);
  },

  /**
   * `any` type annotation in TypeScript: `: any`, `<any>`, `as any`.
   */
  tsAnyType(): RegexBuilder {
    return compile([':\\s*any\\b|<\\s*any\\s*>|\\bas\\s+any\\b']);
  },

  /**
   * Trailing whitespace at end of line (anchor at end with $).
   */
  trailingWhitespace(): RegexBuilder {
    return compile(['\\s+$']);
  },

  /**
   * Mixed tabs/spaces at start of line (indent consistency check).
   */
  mixedIndent(): RegexBuilder {
    return compile(['^[ \\t]+( {\\t}|\\t )']);
  },

  /**
   * Trailing newline at end of file (positive — use excludeWhen to skip).
   */
  finalNewlineMissing(): RegexBuilder {
    return compile(['[^\\n]\\z']);
  },

  /**
   * Tab character in indentation (rejects tabs; use excludeWhen for
   * files that intentionally use tabs).
   */
  tabIndent(): RegexBuilder {
    return compile(['^\\t+']);
  },

  /**
   * Four-space indentation (rejects; prefer tabs or 2-space).
   */
  fourSpaceIndent(): RegexBuilder {
    return compile(['^( {4})+']);
  },

  /**
   * Two-space indentation.
   */
  twoSpaceIndent(): RegexBuilder {
    return compile(['^( {2})+']);
  },

  /**
   * `package com.foo` (Java/Kotlin) — useful for class-not-found checks.
   */
  packageDeclaration(): RegexBuilder {
    return compile(['^package\\s+[a-z][a-z0-9_.]*\\s*;']);
  },

  /**
   * `from X import Y` (Python) — useful for import-whitelist checks.
   */
  pythonImport(): RegexBuilder {
    return compile(['^\\s*(from\\s+[\\w.]+\\s+import\\s+|import\\s+[\\w.]+)']);
  },

  /**
   * Java `public class Foo` (top-level type declaration).
   */
  javaPublicClass(): RegexBuilder {
    return compile(['\\bpublic\\s+class\\s+[A-Z]\\w*']);
  },

  /**
   * Java `System.out.println(...)` / `System.err.printf(...)` —
   * stdout noise that should go through a logger.
   */
  javaSystemOut(): RegexBuilder {
    return compile(['\\bSystem\\.(out|err)\\.print(?:ln|f)?\\s*\\(']);
  },

  /**
   * Java `@Override` annotation.
   */
  javaOverride(): RegexBuilder {
    return compile(['@Override\\b']);
  },

  /**
   * Go `package foo` (top-of-file package declaration, anchored).
   */
  goPackageDecl(): RegexBuilder {
    return compile(['^package\\s+[a-z][a-z0-9_]*\\b']);
  },

  /**
   * Go `import "..."` line (single-line form). Multi-line `import (...)`
   * blocks are covered separately by a raw-regex rule if you need them.
   */
  goImport(): RegexBuilder {
    return compile(['^import\\s+(?:"[^"]+"|`[^`]+`)']);
  },

  /**
   * Go `func main(...)` — entry-point declaration.
   */
  goFuncMain(): RegexBuilder {
    return compile(['^func\\s+main\\s*\\(']);
  },
} as const;