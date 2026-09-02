import sinon from 'sinon';
import {createMemoryHistory} from 'history';
import type {History, MemoryHistoryOptions} from 'history';
import type {WrappedLocation} from '../src/types';

// https://github.com/testing-library/react-testing-library/issues/1197
export function useFakeTimers(...args: Parameters<typeof sinon.useFakeTimers>) {
  const sinonClock = sinon.useFakeTimers.call(sinon, ...args);

  // @ts-expect-error
  globalThis.jest = {
    advanceTimersByTime: sinonClock.tickAsync.bind(sinonClock)
  };

  const restore = sinonClock.restore.bind(sinonClock);
  sinonClock.restore = function () {
    // @ts-expect-error
    delete globalThis.jest;
    return restore();
  };
  return sinonClock;
}

/**
 * Browser-like history double: `go()` traversals land on a macrotask
 * (popstate is asynchronous in real browsers) while push/replace stay
 * synchronous, so tests can run router-driven commits inside a pending
 * rewind window — the interleaving memory history(synchronous `go`)
 * can never produce.
 *
 * 与真实浏览器一致：go 的遍历经宏任务异步落地，push/replace 同步生效，
 * 用于测试回摆窗口内的导航交错。
 */
export function createAsyncGoHistory(
  options: MemoryHistoryOptions = {}
): History & {location: WrappedLocation} {
  const inner = createMemoryHistory(options);
  const go = (delta: number) => {
    // A real popstate lands on a task, never a microtask.
    setTimeout(() => inner.go(delta), 0);
  };
  return {
    get location() {
      return inner.location;
    },
    get action() {
      return inner.action;
    },
    createHref: inner.createHref.bind(inner),
    push: inner.push.bind(inner),
    replace: inner.replace.bind(inner),
    go,
    back: () => go(-1),
    forward: () => go(1),
    listen: inner.listen.bind(inner),
    block: inner.block.bind(inner)
  } as History & {location: WrappedLocation};
}
