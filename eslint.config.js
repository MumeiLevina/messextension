import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', '.artifacts/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions, ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
