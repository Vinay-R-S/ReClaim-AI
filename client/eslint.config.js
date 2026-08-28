import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Kept identical to server/eslint.config.js so the same line does not pass
      // in one workspace and fail in the other.
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'warn',

      // Downgraded to warn so `npm run lint` is green on a codebase that has not
      // been through the remediation phases yet.
      // Promote each back to 'error' in the phase that clears it:
      //   no-explicit-any        -> phase 13, shared domain types (ARCH-08)
      //   no-unused-vars         -> phase 18, dead code sweep (ARCH-05)
      //   set-state-in-effect    -> phase 12, AuthContext races (UI-11, LOG-20)
      //   exhaustive-deps        -> phase 15, data fetching moves into hooks (ARCH-13)
      //   static-components      -> phase 15, component decomposition (ARCH-13)
      //   only-export-components -> phase 15, component decomposition (ARCH-13)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/static-components': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
])
