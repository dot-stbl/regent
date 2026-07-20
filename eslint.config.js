import js from '@eslint/js';
import ts from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      // CLI tool: console.log/warn/error is the right way to emit
      // stdout/stderr. The `no-console` rule is intended for libraries,
      // not CLI entry points — disabled here.
      'no-console': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'assets/stbl/**',
      'coverage/**',
      'test/fixtures/**',
    ],
  },
];