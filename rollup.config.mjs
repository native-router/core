/* eslint-disable import/no-extraneous-dependencies */

import {babel} from '@rollup/plugin-babel';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.mjs',
    format: 'esm'
  },
  external: ['history', 'path-to-regexp'],
  plugins: [
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.ts']
    }),
    nodeResolve({
      extensions: ['.js', '.ts']
    }),
    replace({
      preventAssignment: true,
      'process.env.NODE_ENV': JSON.stringify('production'),
      __DEV__: () => JSON.stringify(false)
    })
  ]
};
