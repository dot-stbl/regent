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
