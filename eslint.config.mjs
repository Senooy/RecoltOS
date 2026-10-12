/**
 * ESLint flat config : typescript-eslint typé, react-hooks sur le renderer,
 * frontières de couches (pas d'`electron` dans shared/db/import/ingest/sync/ai/host ;
 * pas de node/electron/natifs dans le renderer), prettier en dernier.
 */
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const electronBan = {
  paths: [{ name: 'electron', message: 'Pas d’import electron ici : injecter la dépendance.' }],
  patterns: [{ group: ['electron/*'], message: 'Pas d’import electron ici.' }],
}

export default defineConfig(
  {
    ignores: [
      'node_modules',
      'out',
      'dist',
      'dist-extension',
      'coverage',
      'test-results',
      'playwright-report',
      '.visual',
      '.tmp',
      '.tmp-*',
      '.bin-cache',
      '.worktrees',
      'docs',
      'tests/fixtures/sync',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Scripts en ligne de commande : la sortie standard est leur interface.
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'Le renderer passe par window.recolt.' },
            { name: 'better-sqlite3', message: 'La base vit dans main.' },
            { name: 'sharp', message: 'Les médias sont traités par les workers.' },
          ],
          patterns: [
            { group: ['node:*'], message: 'Pas de module Node dans le renderer.' },
            { group: ['@main/*', '**/main/**'], message: 'Le renderer n’importe pas main.' },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/shared/**/*.ts',
      'src/main/db/**/*.ts',
      'src/main/import/**/*.ts',
      'src/main/importers/**/*.ts',
      'src/main/ingest/**/*.ts',
      'src/main/sync/**/*.ts',
      'src/main/ai/**/*.ts',
      'src/host/**/*.ts',
    ],
    rules: { 'no-restricted-imports': ['error', electronBan] },
  },
  {
    files: ['src/main/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'ffmpeg-static',
              message: 'ffmpeg système via platform/binaries.ts.',
            },
          ],
        },
      ],
    },
  },
  prettier,
)
