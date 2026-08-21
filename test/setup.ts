// Mirrors the old .mocharc.js require list (`should`, `should-sinon`).
// `global-jsdom/register` and `test/babel-register.js` are dropped: the tests
// only use createMemoryHistory (no DOM) and vitest transpiles TS itself.
import 'should';
import 'should-sinon';
