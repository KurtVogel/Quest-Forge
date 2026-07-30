import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Layering rules (2026-07-31 review): production code must not reach into
// src/dev/ (dev-only tooling that would ship in the bundle). main.jsx is the
// one sanctioned exception — the dev-settings seeder must run synchronously
// before the store initializes and self-gates on import.meta.env.DEV.
const noDevImports = {
  'no-restricted-imports': ['error', {
    patterns: [{
      group: ['**/dev/*', '*/dev/*'],
      message: 'src/dev/ is dev-only tooling; production code must not import it (see eslint.config.js).',
    }],
  }],
}

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    rules: {
      // `^_` only — the old `^[A-Z_]` exempted every dead ALL_CAPS constant,
      // which is exactly how unused exports accumulated (2026-07-30 review).
      // jsx-uses-vars marks JSX component references as usage, which is what
      // the broad capital-letter exemption was (over-)compensating for.
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      ...noDevImports,
    },
  },
  {
    // dice.ts holds the crypto-dice guarantee and was previously linted by
    // NOTHING (the block above only matched js/jsx).
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      ...noDevImports,
    },
  },
  {
    // Node-run tooling: eval/playtest scripts and config files.
    files: ['scripts/**/*.{js,cjs,mjs}', '*.config.js', 'vite.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // The sanctioned exceptions to the dev-import ban: the entry point (see
    // note above) and dev tooling itself.
    files: ['src/main.jsx', 'src/dev/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
])
