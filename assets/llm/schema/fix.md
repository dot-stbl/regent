# Schema — fix rule

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | yes | stable id, namespaced |
| `severity` | `'error' \| 'warning' \| 'suggestion'` | yes | drives exit code + reporter colour |
| `find` | `string` | yes | RE2 source, per-line |
| `replace` | `string` | yes | string form only (no function); may be empty (deletion) |
| `all` | `boolean` | no | default `true` — replace every match |
| `globs` | `string[]` | yes | file globs to scan |
| `excludePaths` | `string[]` | no | file globs OR `@group` refs |
| `message` | `string` | yes | short human message |
| `dependsOn` | `string[]` | no | rule ids that must run first (DAG) |

## JSON Schema (regent llm schema fix --json)

```json
{
  "type": "object",
  "required": ["id", "severity", "find", "replace", "globs", "message"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "severity": { "enum": ["error", "warning", "suggestion"] },
    "find": { "type": "string", "minLength": 1 },
    "replace": { "type": "string" },
    "all": { "type": "boolean" },
    "globs": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "excludePaths": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "message": { "type": "string", "minLength": 1 },
    "dependsOn": { "type": "array", "items": { "type": "string", "minLength": 1 } }
  }
}
```
