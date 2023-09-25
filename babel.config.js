module.exports = {
  presets: ['@babel/typescript'],
  env: {
    test: {
      presets: [
        '@linaria',
        ['@babel/env', {targets: {node: true}, modules: 'commonjs'}],
        '@babel/typescript'
      ],
      plugins: [
        [
          'module-resolver',
          {
            alias: {
              '@native-router/core': `${__dirname}/src/index.tsx`,
              '^@@/(.*)': `${__dirname}/src/\\1`,
              '^@/(.*)': `${__dirname}/demos/\\1`
            },
            extensions: ['.ts', '.tsx', '.js', '.jsx']
          }
        ]
      ]
    },
    production: {
      presets: [['@babel/env', {modules: false}], '@babel/typescript']
    }
  }
};
