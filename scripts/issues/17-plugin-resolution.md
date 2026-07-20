## Context

CONTRIBUTING.md documents the package shape: `{ name, main, exports }`
but loader doesn't resolve npm packages. Need a `resolveExtends`
that does `import('@scope/regent-rules-x')` for known packages
and falls back to path resolution for everything else.

## Current behaviour

`extends: '@scope/regent-rules-x'` triggers an error in
`src/loader.ts:286` ("built-in presets are removed in v0.2") — false
positive: any string starting with '@' is treated as a preset.

## Expected behaviour

- `extends: '<path>'` — local file/dir/glob (current behaviour)
- `extends: '@scope/pkg'` — npm package import via dynamic import
- `extends: 'pkg'` — bare spec? Probably not — keep npm-only

The fix: detect `@scope/pkg` by looking for a package boundary
(`/`) in the @-prefixed string. If `/` present → npm import.
Otherwise → error message about built-in presets.

## Acceptance criteria

- [ ] `extends: '@scope/regent-rules-x'` imports a real npm package
- [ ] Unknown `@scope/...` (not installed) → clear error
- [ ] Local paths still work
- [ ] CONTRIBUTING.md documents the plugin authoring surface
- [ ] Test: `test/plugin-load.test.ts` (uses a fixture package)

## References

- src/loader.ts:286 (preset check, false-positive today)
- CONTRIBUTING.md (mentions plugin shape)
- Plan: Phase 9 agent contract
