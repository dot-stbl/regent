# Schema

regent rules are TypeScript objects validated by Zod. The full
schema lives in `src/config/schema.ts`; this index gives the
markdown version for an LLM agent.

| Kind | Spec |
|------|------|
| **detect** | [`detect.md`](./detect.md) — match → report |
| **fix** | [`fix.md`](./fix.md) — match → string replace |

For a machine-readable JSON Schema, run `regent llm schema <kind> --json`
(Phase 9+).
