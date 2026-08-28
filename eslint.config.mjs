// Flat config（ESLint 10 起仅支持此格式）。
// airbnb / airbnb-typescript / compat 仍是 eslintrc 格式，经 FlatCompat 转换，规则集与旧 .eslintrc.js 保持一致。
// @ts-check
import { FlatCompat } from '@eslint/eslintrc';
import eslintConfigPrettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

const compat = new FlatCompat();
const isProduction = process.env.NODE_ENV === 'production';

// airbnb-typescript 面向 @typescript-eslint v7；v8 移除了其引用的部分规则：
// - 纯格式规则（indent/quotes/semi 等）：本配置末尾的 eslint-config-prettier 会将其全部关闭，直接丢弃，无行为差异；
// - no-throw-literal：v8 官方改名为 only-throw-error，需映射以保留语义。
const availableTsRules = new Set(Object.keys(tsPlugin.rules));
/** @type {Record<string, string>} */
const renamedTsRules = { 'no-throw-literal': 'only-throw-error' };

/**
 * @param {import('eslint').Linter.Config} config
 */
function fixTsRules(config) {
  if (!config.rules) return config;
  /** @type {NonNullable<import('eslint').Linter.Config['rules']>} */
  const rules = {};
  for (const [key, value] of Object.entries(config.rules)) {
    if (key.startsWith('@typescript-eslint/')) {
      const name = key.slice('@typescript-eslint/'.length);
      if (!availableTsRules.has(name)) {
        const renamed = renamedTsRules[name];
        if (renamed && availableTsRules.has(renamed)) {
          rules[`@typescript-eslint/${renamed}`] = value;
        }
        continue;
      }
    }
    rules[key] = value;
  }
  return { ...config, rules };
}

// lint 范围（src/test/根目录 js）内没有任何 .tsx/.jsx 文件（React 绑定在 @native-router/react 包），
// react / jsx-a11y 规则无作用对象；且 eslint-plugin-react 7.37 / jsx-a11y 6.10 未支持 ESLint 10
// （部分规则加载即崩溃：legacy context API 已移除）。故整体关闭，待上游支持后移除。
/**
 * @param {import('eslint').Linter.Config[]} configs
 * @returns {Record<string, 'off'>}
 */
function collectReactRules(configs) {
  /** @type {Record<string, 'off'>} */
  const off = {};
  for (const config of configs) {
    for (const key of Object.keys(config.rules || {})) {
      if (key.startsWith('react/') || key.startsWith('jsx-a11y/')) off[key] = 'off';
    }
  }
  return off;
}

const baseConfigs = compat.extends('airbnb', 'airbnb-typescript', 'plugin:compat/recommended').map(fixTsRules);
const reactRulesOff = collectReactRules(baseConfigs);

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['dist/'],
  },
  ...baseConfigs,
  eslintConfigPrettier,
  { rules: reactRulesOff },
  {
    plugins: {
      prettier: prettierPlugin,
    },
    languageOptions: {
      // env: browser/node/commonjs/es6 的 flat 等价物；ES 内置全局由 ecmaVersion 自动提供
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.commonjs,
        __DEV__: 'writable',
      },
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    settings: {
      'import/resolver': 'eslint-import-resolver-typescript',
      // 显式指定版本：react 插件的 'detect' 在 ESLint 10 下崩溃（context.getFilename 已移除），
      // 且本库不依赖 react（detect 亦回退到 latest），语义等价。
      react: { version: '19.0.0' },
      polyfills: [
        // App which dependence this lib should pollyfill these methods:
        'Promise',
      ],
    },
    rules: {
      'prettier/prettier': 'error',
      'react/jsx-props-no-spreading': 'off',
      'no-return-assign': ['error', 'except-parens'],
      'no-shadow': 'off',
      'no-plusplus': 'off',
      'no-param-reassign': 'off',
      'react/require-default-props': 'off',
      'react/react-in-jsx-scope': 'off',
      'no-use-before-define': ['error', { functions: false }],
      '@typescript-eslint/no-use-before-define': ['error', { functions: false }],
      'import/no-extraneous-dependencies': ['error', { devDependencies: ['{demos,test}/**/*'] }],
      'no-console': isProduction ? 'error' : 'warn',
      'no-debugger': isProduction ? 'error' : 'off',
    },
  },
  {
    // 原 test/.eslintrc.js 的覆盖配置。'builtin-compat/no-incompatible-builtins'
    // 在 eslint-plugin-compat 7 中已不存在（旧规则名），故不迁移。
    files: ['test/**/*'],
    languageOptions: {
      globals: {
        // Provided by vitest `globals: true` (see vitest.config.ts).
        describe: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        before: 'readonly',
        after: 'readonly',
      },
    },
    rules: {
      'func-names': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
