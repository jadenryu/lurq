import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      // Both build targets (tsup writes the operator bundle to dist-operator/).
      'dist/**',
      'dist-operator/**',
      'node_modules/**',
      'coverage/**',
      'drizzle/**',
      // The apps lint themselves (next lint); the root config lacks their
      // plugins and would otherwise scan their build output (.next / .source)
      // and report tens of thousands of false errors from generated files.
      'apps/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS Node scripts (the npm lifecycle hooks, which must run without
    // tsx). typescript-eslint switches `no-undef` off for .ts files, so only
    // these need the Node globals spelled out.
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
