# csharp.exceptions.brace-style

A trailing closing brace on the same line as code (`foo; }`) must move
to its own line. C# block structure is most readable when each `}`
sits alone — pair with `csharp.code-shape.region-directive` for a
broader structural-shape enforcement suite.

## Code

```ts
// examples/csharp/csharp.exceptions.brace-style.lint.ts
import { defineRule } from '@dot-stbl/regent';

export default defineRule({
  id: 'csharp.exceptions.brace-style',
  severity: 'warning',
  pattern: '[^\\s}]\\s+}$',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: 'A trailing closing brace must be on its own line.',
  source: 'code-shape.md#braces',
  rationale: 'Closing braces on their own line keep C# block structure visually consistent.',
  fix: {
    kind: 'function',
    safety: 'safe',
    title: 'move trailing closing braces to their own line',
    apply: ({ content }) => {
      const edits: Array<{ start: number; end: number; replacement: string }> = [];
      let lineStart = 0;
      for (const line of content.split('\n')) {
        const match = /^(\s*).*\S(\s+)}\r?$/.exec(line);
        if (match !== null) {
          const whitespace = match[2] ?? '';
          const brace = line.lastIndexOf('}');
          const indent = match[1] ?? '';
          edits.push({
            start: lineStart + brace - whitespace.length,
            end: lineStart + brace + 1,
            replacement: `\n${indent}}`,
          });
        }
        lineStart += line.length + 1;
      }
      return edits;
    },
  },
});
```

## Fix shape

- **`kind`: `function`** — programmatic. The rewrite is a
  per-line text edit that needs to compute byte offsets from the line
  text + indent; declarative templates can't express it.
- **`safety`: `safe`** — `regent fix` applies the function-form edit
  when invoked with `--unsafe`. The default safe lane (without
  `--unsafe`) skips function-form fixes — see CONTRIBUTING.md
  "Authoring a fix" § safety lanes.
- **`apply`**: pure + deterministic per the contract — reads `content`
  only, returns `RuleFixEdit[]` (byte spans + replacements). No I/O,
  no time, no global state.

## When to apply

- Strict control over C# block structure.
- Useful when a legacy codebase has trailing-brace shapes that hide
  block boundaries in code review.

## Testing

`examples/csharp/__fixtures__/csharp.exceptions.brace-style/{bad,good,fixed}.cs`:

- `bad.cs` — `public void Run() { Execute(); }` on one line; rule
  fires.
- `good.cs` — the `Run()` body expanded across multiple lines, with
  `}` on its own line; rule does not fire.
- `fixed.cs` — the literal `regent fix --unsafe` output: the
  trailing `}` is moved to the next line, preserving the line's
  indent. The opening `{` is left in place (declarative templates
  can't reshape a method head — that needs a real formatter).

`fixed.cs` and `good.cs` legitimately differ — `fixed.cs` is the
literal mechanical output of the function-form fix, `good.cs` is the
human-cleaned final shape. The shipped-examples test asserts
`fixed.cs` equals engine output, NOT that it equals `good.cs`.
