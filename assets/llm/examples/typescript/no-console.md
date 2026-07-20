# typescript.no-console

`console.log` / `console.error` etc. in production code. Use this as
a template for any "use-the-project-logger" rule.

## Code

```ts
// examples/typescript/no-console.lint.ts
import { defineDetectRule } from '@dot-stbl/regent';
import { patterns } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'typescript.no-console',
  severity: 'warning',
  pattern: patterns.consoleLog().toRegex(),
  globs: ['**/*.ts', '**/*.tsx'],
  excludePaths: [
    '@generated',
    '@node-modules',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/scripts/**',
  ],
  message: '`console.log` left in production code — use a structured logger.',
});
```

## When to apply

- Production code should use pino / winston / your logger.
- Test files are exempt (they often need `console.log` for debug).
- Scripts under `scripts/` are exempt (one-off use, not app code).

## Testing

- `bad.ts` has `console.log('hi')` and `console.error('oops')` — fires.
- `good.ts` uses `logger.info('hi')` — does not fire.
