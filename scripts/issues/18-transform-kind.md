## Context

Phase 3 of the v0.2 plan committed to three rule kinds: detect,
fix, and transform. v0.2 shipped the first two (`defineDetectRule`,
`defineFixRule`). Transform was deferred to v0.3 by user request.
The schema field `kind: 'transform'` exists in
`src/config/schema.ts` but nothing in the loader, runner, or CLI
recognises it. `defineTransformRule` is not exported.

## Current behaviour

A `.transform.ts` file is silently ignored by the loader (it globs
for `.lint.ts` and `.rule.ts` only). A rule with `kind: 'transform'`
in an inline config is accepted by Zod but never executed by the
runner.

## Expected behaviour

```ts
// examples/<lang>/transform-example.transform.ts
import { defineTransformRule } from '@dot-stbl/regent';

export default defineTransformRule({
  id: 'meta.prettier-imports',
  severity: 'warning',
  transform: (file, content) => sortImports(content),
  globs: ['**/*.ts'],
  message: 'sort imports',
});
```

Pipeline order: detect → fix → transform (last).
- `defineTransformRule` exported from `@dot-stbl/regent`.
- Runner dispatches by `kind` after fix rules complete.

## Acceptance criteria

- [ ] `defineTransformRule` exported with frozen typed wrapper
- [ ] Loader discovers `.transform.ts` files
- [ ] Runner runs transform rules after fix in dependency order
- [ ] `--write` writes transformed content; `--check` reports diff
- [ ] At least one example transform rule shipped
- [ ] Test: `test/transform-pipeline.test.ts` end-to-end

## References

- src/config/schema.ts:TransformRuleSpecSchema (schema exists)
- src/define-rule.ts (no defineTransformRule yet)
- Plan: Phase 3 multi-mode kinds (deferred to v0.3 per user)
