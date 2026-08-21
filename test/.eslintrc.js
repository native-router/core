module.exports = {
  globals: {
    // Provided by vitest `globals: true` (see vitest.config.ts).
    describe: 'readonly',
    it: 'readonly',
    beforeEach: 'readonly',
    afterEach: 'readonly',
    before: 'readonly',
    after: 'readonly'
  },
  rules: {
    'builtin-compat/no-incompatible-builtins': 'off',
    'func-names': 'off',
    '@typescript-eslint/no-unused-vars': 'off'
  }
};
