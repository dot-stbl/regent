## Context

`zod-to-json-schema` is in dependencies and Phase 9 plan called for
`regent llm schema detect --json` / `--json fix`, but neither flag
is wired. Today the command only emits markdown tables.

## Current behaviour

`regent llm schema detect` — markdown only.
No machine-readable schema for LLM agents that need typed
config-generation code.

## Expected behaviour

- `regent llm schema detect --json` → valid JSON Schema 2020-12 document
- `regent llm schema fix --json` → same shape
- (default markdown still works for human reading)

## Acceptance criteria

- [ ] `--json` flag works for both detect and fix schemas
- [ ] Output is valid JSON Schema (parseable by ajv or similar)
- [ ] Includes all fields from the Zod schema (required + optional)
- [ ] Test: `test/llm-schema-json.test.ts` validates the JSON

## References

- src/config/schema.ts:RegentConfigSchema
- src/llm-router.ts:routeLlm (no --json branch today)
- Plan: Phase 9 agent contract
