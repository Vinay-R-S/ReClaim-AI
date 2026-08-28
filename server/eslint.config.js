import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // Track A phase 2 replaces console with a logger util. Warn until then.
      'no-console': 'warn',
      // Track A coding standards: no `any`, early returns, explicit contracts.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      // Downgraded to warn for now so `npm run lint` is green on a codebase that
      // has not been through the remediation phases yet. Promote each to 'error'
      // in the phase that fixes it:
      //   preserve-caught-error  -> phase 2, AppError and the central error path (ARCH-02)
      //   ban-ts-comment         -> phase 16, removes the dead node-fetch @ts-ignore (PERF-06)
      'preserve-caught-error': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
    },
  },
]);
