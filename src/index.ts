/**
 * Public surface of `@dot-stbl/regent`.
 *
 * The library exports:
 *   - `defineRule` / `defineConfig` — type-safe rule + config helpers
 *   - `loadRules` — 4-layer discovery (returns accept-list merged)
 *   - `runRules` — execute compiled rule set with optional accept-list
 *   - `renderText` / `renderSarif` / `renderReview` / `renderReviewJson` — built-in reporters
 *   - types: `RuleSpec`, `CompiledRule`, `Finding`, `ConfigLayer`, `AcceptEntry`, ...
 *   - `DEFAULT_CONTEXT_BUFFER` — exported for tests + advanced consumers
 *
 * **Tri-state review:** `RuleSpec.review.enabled` flips findings to
 * `status: 'pending'`. The loader returns `acceptList`; the runner
 * matches each `(ruleId, path, line)` against it. `renderReview` /
 * `renderReviewJson` format pending findings for LLM triage.
 */

export { defineRule, defineConfig } from './define-rule.js';
export {
  defineDetectRule,
  defineFixRule,
  defineTransformRule,
  defineAstRule,
} from './kinds/index.js';
export { loadRules, type LoaderOptions, type LoaderRuleSet, type LoadedAcceptEntry } from './loader.js';
export { runRules, runRulesStream, severityAtOrAbove, relativePath, type ScanEvent } from './runner.js';
export { renderText, renderSummary, renderFinding } from './reporter/text.js';
export { renderSarif } from './reporter/sarif.js';
export { renderReview, renderReviewJson } from './reporter/review.js';
export { compileRegex, scanFirst, locationAt, extractContext } from './regex.js';
export { DEFAULT_CONTEXT_BUFFER } from './constants.js';
export { patterns, type RegexBuilder } from './patterns/index.js';
export { DiskCache, cacheKeyFor, defaultCachePath, type CacheKey, type CacheEntry, type CacheStore, type CacheStats } from './core/cache.js';
export { scanAst, type AstGrepConfig, type AstMatch } from './ast/matcher.js';
export { BUNDLES, resolveBundle, type LanguageBundle } from './bundles/index.js';
export type {
  AstRuleSpec,
  CompiledAstRule,
  CompiledTransformRule,
} from './kinds/index.js';

export type {
  RuleSpec,
  RuleOverride,
  RuleReviewSpec,
  RuleFixSpec,
  RuleFixReplace,
  RuleFixDeleteLine,
  RuleFixFunction,
  RuleFixGuidanceOnly,
  RuleFixSafety,
  RuleFixContext,
  RuleFixEdit,
  Severity,
  AcceptEntry,
  ConfigLayer,
  CompiledRule,
  RuleOrigin,
  Match,
  ContextWindow,
  Finding,
  FindingStatus,
  RunnerScope,
  RunResult,
} from './types.js';
export { validateFixSpec } from './types.js';
export type { TransformRuleSpec } from './config/schema.js';
