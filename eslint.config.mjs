import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.wrangler/**', 'test-results/**', 'playwright-report/**', 'renders/**', 'coverage/**'] },
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tsParser } },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    rules: {
      'no-async-promise-executor': 'error',
      'no-dupe-else-if': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error'
    }
  }
];
