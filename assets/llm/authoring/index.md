# Authoring

regent ships two rule kinds in v0.2. Pick the one that matches your
intent:

| Kind | Extension | Use when | File |
|------|-----------|----------|------|
| **detect** | `.lint.ts` | match → report (eslint-style) | [`detect.md`](./detect.md) |
| **fix** | `.fix.ts` | match → string replace (prettier-lite) | [`fix.md`](./fix.md) |

(Transform — programmatic whole-file rewrite — is reserved for v0.3.)

## Common authoring workflow

1. `regent llm examples <lang>` — scan curated examples.
2. Copy one with `regent example copy <lang> <rule-id>` or hand-author.
3. `regent check` — iterate until clean.
4. Commit (do not auto-commit; let humans review).
