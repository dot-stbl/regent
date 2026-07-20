## Context

The shipped examples in `examples/csharp/*.lint.ts` (and ts/python/meta
counterparts) all import `defineRule` via a relative path:

```ts
import { defineRule } from '../../src/define-rule.js';
```

This path is correct only when the file lives at
`examples/csharp/`. After `regent example copy csharp <rule>` writes
the file to `tools/audit/rules/`, the import points to
`<repo>/src/define-rule.js` which doesn't exist in a normal project.
The shipped example is **unusable as a copy-pasted file** in any
project that doesn't also have a `src/` directory with
`define-rule.js`.

## Current behaviour

```
$ regent example copy csharp csharp.exceptions.throw-variable
copied -> ./tools/audit/rules/csharp.csharp.exceptions.throw-variable.lint.ts

$ regent check --all
✓ no findings
0 rules ·
```

The file is copied but the import fails silently (Node's MODULE_NOT
FOUND or the rule just doesn't load). The agent has no way to
discover the failure without opening the file and reading the import.

## Expected behaviour

Two acceptable resolutions:
- (a) **Switch the example to package import**: change the import
  to `from '@dot-stbl/regent'`. Users installing regent as a
  dependency get the named export automatically.
- (b) **`regent example copy` rewrites the import on copy**: when
  writing to a project dir, replace the relative path with the
  package import.

(a) is simpler. (b) makes the example robust to consumers that
use a different import style (e.g. vendoring).

## Acceptance criteria

- [ ] After `regent example copy csharp <rule>`, the copied file
      loads in a fresh project (no `src/` required)
- [ ] `regent check --all` shows the rule's findings
- [ ] Test: `test/example-copy.test.ts` creates a tmp project,
      copies an example, runs check, asserts findings
- [ ] All 14 shipped examples updated if approach (a) is chosen

## References

- examples/csharp/csharp.exceptions.throw-variable.lint.ts:6 (the
  bad import)
- examples/csharp/csharp.async.discard-assignment.lint.ts:6
- (every other shipped example has the same pattern)
- src/examples/index.ts:findExample (the copy target lookup)
- Plan: Phase 1 + Phase 10

## Severity

**Blocker for v0.2.1.** Shipped examples are the primary on-ramp
for an LLM agent; if they don't work when copied, the entire
agent-first contract is broken.
