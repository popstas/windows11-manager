import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  {
    ignores: ['vendor/**', 'tauri-app/**', 'dist/**', 'node_modules/**', 'data/**'],
  },
];
