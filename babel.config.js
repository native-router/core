module.exports = {
  presets: ['@babel/typescript'],
  env: {
    production: {
      presets: [['@babel/env', {modules: false}], '@babel/typescript']
    }
  }
};
