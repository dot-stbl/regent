/**
 * Example detect rule — bare `new HttpClient(...)` leaks sockets and pins DNS.
 *
 * Mirrors `http-resilience-refit.md#never-new-httpclient`. Use as a template
 * for framework-bypass detection rules.
 */
import { defineRule } from '../../src/define-rule.js';

export default defineRule({
  id: 'csharp.http.bare-httpclient',
  severity: 'error',
  pattern: '\\bnew\\s+HttpClient\\s*\\(',
  globs: ['**/*.cs'],
  excludePaths: ['**/bin/**', '**/obj/**'],
  message: '`new HttpClient(...)` — bare construction leaks sockets and pins DNS.',
  source: 'http-resilience-refit.md#never-new-httpclient',
  rationale:
    'Refit interfaces registered via `AddRefitClient<T>()` already get `IHttpClientFactory` and Polly resilience. Hand-rolling the client skips both.',
});
