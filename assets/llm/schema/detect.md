# Schema — detect rule

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | yes | stable id, namespaced (`<lang>.<topic>`) |
| `severity` | `'error' \| 'warning' \| 'suggestion'` | yes | drives exit code + reporter colour |
| `pattern` | `string` | yes | RE2 source, per-line |
| `excludeWhen` | `string` | no | RE2 source; matches skip the finding |
| `globs` | `string[]` | yes | file globs to scan |
| `excludePaths` | `string[]` | no | file globs OR `@group` refs |
| `message` | `string` | yes | short human message |
| `source` | `string` | no | back-link to `.md` prose |
| `rationale` | `string` | no | longer explanation |
| `review` | `object` | no | tri-state review spec |
| `review.enabled` | `boolean` | yes (when `review`) | flips findings to `pending` |
| `review.guidance` | `string` | no | what the reviewer should check |
| `review.exitBehavior` | `'no-fail' \| 'unreviewed-fails'` | no | default `no-fail` |
| `dependsOn` | `string[]` | no | rule ids that must run first (DAG) |

## JSON Schema (regent llm schema detect --json)

```json
{
  "type": "object",
  "required": ["id", "severity", "pattern", "globs", "message"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "severity": { "enum": ["error", "warning", "suggestion"] },
    "pattern": { "type": "string", "minLength": 1 },
    "excludeWhen": { "type": "string" },
    "globs": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "excludePaths": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "message": { "type": "string", "minLength": 1 },
    "source": { "type": "string" },
    "rationale": { "type": "string" },
    "review": {
      "type": "object",
      "required": ["enabled"],
      "additionalProperties": false,
      "properties": {
        "enabled": { "type": "boolean" },
        "guidance": { "type": "string" },
        "exitBehavior": { "enum": ["no-fail", "unreviewed-fails"] }
      }
    },
    "dependsOn": { "type": "array", "items": { "type": "string", "minLength": 1 } }
  }
}
```
