## Context

`src/config/sources/file.ts:323` defines `loadYamlLike` for `.yaml`/`.yml`
files but it throws an error directing users to use JSON. Meanwhile
the `searchPlaces` array in the same file advertises `.regentrc.yaml`
and `.regentrc.yml` as valid extensions, and CONTRIBUTING.md mentions
YAML as a recognised format. Either commit to YAML or remove the
adverts — current state is a footgun.

## Current behaviour

A repo with `.regentrc.yaml`:
- cosmiconfig discovers the file (via the searchPlaces list)
- the loader calls `loadYamlLike` which throws
- user sees: "regent: YAML config at <path> — JSON is the recommended format"
- exit 1

## Expected behaviour

Two acceptable resolutions:
- (a) Add `js-yaml` (or hand-rolled mini-parser) and route
  `.yaml`/`.yml` through the same `safeParseConfig` pipeline as
  JSON/TS. (a) is preferred — YAML is a common preference.
- (b) Remove `.regentrc.yaml` and `.regentrc.yml` from
  `searchPlaces`, drop `loadYamlLike`, and surface a clear "YAML
  is not supported in v0.2" message.

## Acceptance criteria

- [ ] A fixture repo with `.regentrc.yaml` (one detect rule + comment)
      loads via `regent check --all` and reports the expected finding
- [ ] Unknown keys in YAML still fail-fast via Zod strict mode
- [ ] CHANGELOG / README notes whether YAML is supported
- [ ] Test: `test/config-yaml.test.ts` covers YAML loading end-to-end

## References

- src/config/sources/file.ts:323 (loadYamlLike)
- src/config/sources/file.ts:17 (searchPlaces advertises YAML)
- CONTRIBUTING.md
- Plan: Phase 1.5a config foundation
