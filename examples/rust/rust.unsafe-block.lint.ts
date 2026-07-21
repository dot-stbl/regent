/**
 * Example detect rule — `unsafe { ... }` blocks in non-test code.
 *
 * `unsafe` is sometimes required (FFI, low-level data structures),
 * but it's worth a deliberate comment when used in production
 * paths. Use this as a template for security-sensitive Rust rules.
 */
import { defineDetectRule } from '@dot-stbl/regent';

export default defineDetectRule({
  id: 'rust.unsafe-block',
  severity: 'warning',
  pattern: '\\bunsafe\\s*\\{',
  excludeWhen: '//\\s*unsafe-allow',
  globs: ['**/*.rs'],
  excludePaths: ['**/tests/**', '**/benches/**', '**/examples/**'],
  message:
    '`unsafe { ... }` block found. Add a `// unsafe-allow: <reason>` ' +
    'comment on the SAME line as the `unsafe` keyword, or extract ' +
    'behind a documented safe wrapper.',
  source: 'unsafe-block.md#rust',
  rationale:
    'Rust `unsafe` is permitted but every site should be justified. ' +
    'A short comment links the unsafe block to its invariant and lets ' +
    'reviewers audit the safety argument.',
});