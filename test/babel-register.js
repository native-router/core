const register = require('@babel/register');

// eslint-disable-next-line no-underscore-dangle
global.__DEV__ = true;

register({extensions: ['.jsx', '.ts', '.tsx']});
