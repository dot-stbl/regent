/**
 * Test-local rule fixture — mirroring
 * `http-resilience-refit.md#never-new-httpclient`.
 *
 * This file is intentionally under `test/rules/csharp/`, not
 * `regent/src/presets/csharp.ts` and not `~/.agents/rules/csharp/`.
 * It exists only as a test exercise for `test/fixtures.test.ts`.
 */
import { defineRule } from '../../../src/define-rule.js';

export default defineRule({
  id: 'csharp.http.bare-httpclient',
  severity: 'error',
  pattern: '\\bnew\\s+HttpClient\\s*\\(',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`new HttpClient(...)` — bare construction leaks sockets and pins DNS.',
  source: 'http-resilience-refit.md#never-new-httpclient',
  rationale: 'Refit interfaces registered via `AddRefitClient<T>()` already get `IHttpClientFactory` and Polly resilience. Hand-rolling the client skips both.',
});
