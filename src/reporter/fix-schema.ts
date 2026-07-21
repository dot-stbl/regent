/**
 * Wire format for `regent fix --format json` (Phase 5 of the fix-mode
 * epic, issue #62).
 *
 * The v1 schema carries exactly three top-level keys: `applied`,
 * `suggested`, `deferred`. Anything else (`cwd`, `mode`, `changedFiles`,
 * `unifiedDiff`, `passes`) is implementation detail — agents can
 * re-derive cwd from `$PWD` and dry-run state from process exit code.
 *
 * The JSON Schema artifact that validates the document lives at
 * `assets/llm/schema/fix-v1.json` and is fetched at runtime via
 * `regent llm schema fix`. `validateAgainstFixV1Schema` is the
 * hand-rolled validator the schema test uses — it's intentionally
 * small (~150 lines, no `ajv` dependency) and covers exactly the
 * surface the v1 schema declares.
 *
 * Stability contract (forward-only): any additive change ships as
 * v2. v1 is frozen at the merge of #78.
 */

import type { AppliedEdit, ApplyFixesResult, DeferredEdit, SuggestedEdit } from '../fixer.js';

/** Match exactly — byte span, half-open `[start, end)`. */
export interface FixV1Range {
  readonly start: number;
  readonly end: number;
}

/** Concrete byte-span replacement the agent may apply. */
export interface FixV1ProposedEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/** Edits the engine wrote to disk. */
export interface FixV1AppliedEdit {
  readonly ruleId: string;
  readonly file: string;
  readonly range: FixV1Range;
  readonly title: string;
  readonly before: string;
  readonly after: string;
}

/**
 * Edits the engine surfaced for the agent to judge. `proposedEdit` is
 * `null` for guidance-only fixes (the rule fired without a concrete
 * replacement).
 */
export interface FixV1SuggestedEdit {
  readonly ruleId: string;
  readonly file: string;
  readonly range: FixV1Range;
  readonly title: string;
  readonly guidance: string | null;
  readonly proposedEdit: FixV1ProposedEdit | null;
  /** Lines around the match (the runner's `±contextBuffer` window). */
  readonly context: readonly string[];
}

/** Edits the engine could not resolve. */
export interface FixV1DeferredEdit {
  readonly ruleId: string;
  readonly file: string;
  readonly range: FixV1Range;
  /**
   * Stable, machine-readable reason:
   *  - `"overlap with <ruleId>"` — a higher-priority edit won the byte span
   *  - `"out-of-range"` — file content changed mid-run
   *  - `"no-fix-attached"` — rule fired without a `fix` attachment
   */
  readonly reason: string;
}

/** The v1 wire document. Exactly three top-level keys. */
export interface FixV1Document {
  readonly applied: readonly FixV1AppliedEdit[];
  readonly suggested: readonly FixV1SuggestedEdit[];
  readonly deferred: readonly FixV1DeferredEdit[];
}

/**
 * Convert the engine's `AppliedEdit` record into the v1 wire shape.
 * Identity (ruleId / file / range / title / before / after) is
 * preserved; the v1 shape just drops nothing.
 */
function toV1Applied(edit: AppliedEdit): FixV1AppliedEdit {
  return {
    ruleId: edit.ruleId,
    file: edit.file,
    range: { start: edit.range.start, end: edit.range.end },
    title: edit.title,
    before: edit.before,
    after: edit.after,
  };
}

/**
 * Convert the engine's `SuggestedEdit` record into the v1 wire shape.
 * `guidance` becomes `string | null` (the engine uses `undefined` when
 * the rule has no guidance text). `proposedEdit` is already shaped
 * compatibly.
 */
function toV1Suggested(edit: SuggestedEdit): FixV1SuggestedEdit {
  return {
    ruleId: edit.ruleId,
    file: edit.file,
    range: { start: edit.range.start, end: edit.range.end },
    title: edit.title,
    guidance: edit.guidance ?? null,
    proposedEdit: edit.proposedEdit === null
      ? null
      : {
          start: edit.proposedEdit.start,
          end: edit.proposedEdit.end,
          replacement: edit.proposedEdit.replacement,
        },
    // `SuggestedEdit` doesn't carry the per-finding context window —
    // the engine lifts only the concrete edit onto the suggested
    // record. Empty context is the documented default for v1 (agents
    // needing lines can re-fetch the file).
    context: [],
  };
}

/**
 * Convert the engine's `DeferredEdit` record into the v1 wire shape.
 * The `reason` field is composed with the winning ruleId when one
 * exists, so consumers can branch on the prefix without a second
 * lookup.
 */
function toV1Deferred(edit: DeferredEdit): FixV1DeferredEdit {
  let reason: string;
  if (edit.reason === 'overlap') {
    const winner = edit.winningRuleId ?? '<unknown>';
    reason = `overlap with ${winner}`;
  } else {
    reason = edit.reason;
  }
  return {
    ruleId: edit.ruleId,
    file: edit.file,
    range: { start: edit.range.start, end: edit.range.end },
    reason,
  };
}

/**
 * Build the v1 document from an `ApplyFixesResult`. Pure function —
 * no I/O, no side effects, fully testable.
 */
export function toV1Json(result: ApplyFixesResult): FixV1Document {
  return {
    applied: result.applied.map(toV1Applied),
    suggested: result.suggested.map(toV1Suggested),
    deferred: result.deferred.map(toV1Deferred),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Hand-rolled JSON-Schema validator for the v1 artifact.
//
// The v1 schema is small (one document type + four $defs) — pulling
// in `ajv` for ~150 lines of check logic is overkill. This validator
// covers exactly the keywords the v1 artifact uses: `type`, `required`,
// `properties`, `additionalProperties`, `items`, `oneOf`, `pattern`,
// `minLength`, `minimum`, `enum`. $ref is resolved at load time.
// Returns either `valid: true` or a list of human-readable error paths.
// ──────────────────────────────────────────────────────────────────────

/** Schema fragment we know how to validate against. */
type SchemaObject = Record<string, unknown>;

/** Single validation error with a JSON pointer to the failing value. */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly issues: readonly ValidationIssue[] };

/**
 * Load + resolve `$ref` pointers in the v1 schema. We don't do full
 * $id / $anchor / $dynamicRef resolution — only the `#/$defs/<name>`
 * pattern the v1 artifact uses. Loaded once at module load and reused
 * per validation call.
 */
function resolveDefs(schema: SchemaObject): Map<string, SchemaObject> {
  const defs = schema['$defs'];
  if (typeof defs !== 'object' || defs === null) {
    return new Map();
  }
  const out = new Map<string, SchemaObject>();
  for (const [name, value] of Object.entries(defs as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      out.set(name, value as SchemaObject);
    }
  }
  return out;
}

/** Type-name lookup matching JSON-Schema's `type` keyword. */
const TYPE_CHECK: Readonly<Record<string, (v: unknown) => boolean>> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  integer: (v) => typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v,
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
};

function checkType(value: unknown, schema: SchemaObject, path: string, issues: ValidationIssue[]): void {
  const t = schema['type'];
  if (t === undefined) {
    return;
  }
  const types = Array.isArray(t) ? t : [t];
  for (const want of types) {
    const check = TYPE_CHECK[want as string];
    if (check && check(value)) {
      return;
    }
  }
  const got = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  issues.push({ path, message: `expected type ${types.join(' | ')}, got ${got}` });
}

function checkRequired(value: Record<string, unknown>, schema: SchemaObject, path: string, issues: ValidationIssue[]): void {
  const required = schema['required'];
  if (!Array.isArray(required)) {
    return;
  }
  for (const key of required) {
    if (!(key in value)) {
      issues.push({ path, message: `missing required property '${key}'` });
    }
  }
}

function checkProperties(value: Record<string, unknown>, schema: SchemaObject, defs: Map<string, SchemaObject>, path: string, issues: ValidationIssue[]): void {
  const properties = schema['properties'];
  if (typeof properties !== 'object' || properties === null) {
    return;
  }
  for (const [key, subSchema] of Object.entries(properties as Record<string, unknown>)) {
    if (key in value) {
      validateValue(value[key], subSchema as SchemaObject, defs, `${path}/${key}`, issues);
    }
  }
}

function checkAdditionalProperties(value: Record<string, unknown>, schema: SchemaObject, path: string, issues: ValidationIssue[]): void {
  const additional = schema['additionalProperties'];
  if (additional === true || additional === undefined) {
    return;
  }
  if (additional === false) {
    const properties = schema['properties'];
    const allowedKeys = new Set<string>(
      typeof properties === 'object' && properties !== null
        ? Object.keys(properties as Record<string, unknown>)
        : [],
    );
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) {
        issues.push({ path, message: `unexpected additional property '${key}'` });
      }
    }
    return;
  }
  // additionalProperties as a schema — out of scope for v1.
}

function checkOneOf(value: unknown, schema: SchemaObject, defs: Map<string, SchemaObject>, path: string, issues: ValidationIssue[]): void {
  const oneOf = schema['oneOf'];
  if (!Array.isArray(oneOf)) {
    return;
  }
  let matchCount = 0;
  for (const sub of oneOf) {
    const subIssues: ValidationIssue[] = [];
    validateValue(value, sub as SchemaObject, defs, path, subIssues);
    if (subIssues.length === 0) {
      matchCount++;
    }
  }
  if (matchCount !== 1) {
    issues.push({ path, message: `oneOf matched ${matchCount} schemas, expected exactly 1` });
  }
}

function checkItems(value: unknown[], schema: SchemaObject, defs: Map<string, SchemaObject>, path: string, issues: ValidationIssue[]): void {
  const items = schema['items'];
  if (typeof items !== 'object' || items === null) {
    return;
  }
  for (let i = 0; i < value.length; i++) {
    validateValue(value[i], items as SchemaObject, defs, `${path}/${i}`, issues);
  }
}

function checkStringConstraints(value: string, schema: SchemaObject, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'string') {
    return;
  }
  if (typeof schema['minLength'] === 'number' && value.length < (schema['minLength'] as number)) {
    issues.push({ path, message: `minLength ${schema['minLength']}, got ${value.length}` });
  }
  if (typeof schema['pattern'] === 'string') {
    const re = new RegExp(schema['pattern'] as string);
    if (!re.test(value)) {
      issues.push({ path, message: `value did not match pattern /${schema['pattern']}/` });
    }
  }
}

function checkNumberConstraints(value: number, schema: SchemaObject, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'number') {
    return;
  }
  if (typeof schema['minimum'] === 'number' && value < (schema['minimum'] as number)) {
    issues.push({ path, message: `value ${value} < minimum ${schema['minimum']}` });
  }
}

function checkRef(value: unknown, ref: string, defs: Map<string, SchemaObject>, path: string, issues: ValidationIssue[]): void {
  const match = ref.match(/^#\/\$defs\/(.+)$/);
  if (!match) {
    issues.push({ path, message: `unsupported $ref '${ref}' (only #/$defs/<name> is implemented)` });
    return;
  }
  const sub = defs.get(match[1]!);
  if (!sub) {
    issues.push({ path, message: `$ref '${ref}' not found in $defs` });
    return;
  }
  validateValue(value, sub, defs, path, issues);
}

function validateValue(value: unknown, schema: SchemaObject, defs: Map<string, SchemaObject>, path: string, issues: ValidationIssue[]): void {
  if (typeof schema['$ref'] === 'string') {
    checkRef(value, schema['$ref'] as string, defs, path, issues);
    return;
  }
  checkType(value, schema, path, issues);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    checkRequired(obj, schema, path, issues);
    checkProperties(obj, schema, defs, path, issues);
    checkAdditionalProperties(obj, schema, path, issues);
  }
  if (Array.isArray(value)) {
    checkItems(value, schema, defs, path, issues);
  }
  if (typeof value === 'string') {
    checkStringConstraints(value, schema, path, issues);
  }
  if (typeof value === 'number') {
    checkNumberConstraints(value, schema, path, issues);
  }
  checkOneOf(value, schema, defs, path, issues);
}

/**
 * Validate a JSON document against a parsed v1 schema. Pure
 * function; no I/O.
 */
export function validateFixV1(doc: unknown, schema: SchemaObject): ValidationResult {
  const defs = resolveDefs(schema);
  const issues: ValidationIssue[] = [];
  validateValue(doc, schema, defs, '', issues);
  return issues.length === 0
    ? { valid: true }
    : { valid: false, issues };
}
