// SPDX-License-Identifier: Apache-2.0
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'src-tauri/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Node-side helper scripts (release probe etc.), not shipped in the app.
  {
    files: ['scripts/**/*.{mjs,js}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', crypto: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Open-source split (ADR 2026-09-13): the desktop client depends only on
      // the public protocol document, never on gateway internals.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@codai/db', '@codai/db/*'], message: 'Private package (open-source split).' },
            {
              group: ['@codai/providers', '@codai/providers/*'],
              message: 'Private package (open-source split).',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
