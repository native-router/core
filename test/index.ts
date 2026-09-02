import Should from 'should';
import sinon from 'sinon';
import {createMemoryHistory} from 'history';
import {
  create,
  match,
  resolve,
  resolveTo,
  toLocation,
  commit,
  commitReplace,
  navigate,
  refresh,
  go,
  forward,
  back,
  createHref,
  cancel,
  listen,
  setBlocker,
  initHistoryStack,
  invalidate,
  getCurrentView,
  getParams,
  preload,
  reusableEntry,
  mergeMatchedParams
} from '../src/router';
import type {
  BaseRoute,
  ExtractPathParams,
  HistoryState,
  NavAction,
  RouterInstance,
  StandardSchemaV1
} from '../src/types';
import {
  parseParams,
  parseParamsSync,
  parseSearch,
  parseSearchInput,
  parseSearchSync,
  writeSchema
} from '../src/search';
import {
  NativeRouterError,
  NotFoundError,
  ParamsError,
  RedirectLoopError,
  SearchError
} from '../src/errors';
import {createAsyncGoHistory} from './util';

describe('Router', () => {
  describe('match', () => {
    it('should match a path', () => {
      const history = createMemoryHistory();
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        () => Promise.resolve(null)
      );
      const matched = match(router, '/bar');
      matched!.length.should.equal(2);
      matched![1].path.should.equal('/bar');
    });

    it('should fall back to later siblings when a parent prefix matched but no child did', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/a', children: [{path: '/b'}]}, {path: '/*rest'}]
        },
        history,
        () => Promise.resolve(null)
      );
      // `/a` matches the first sibling's prefix but `/b` does not match
      // `/a/q` — the wildcard sibling must still take it instead of 404.
      const matched = match(router, '/a/q');
      matched!.length.should.equal(2);
      matched![1].path.should.equal('/a/q');
      ({...matched![1].params}).should.deepEqual({rest: ['a', 'q']});
    });

    it('should rank a more specific chain over an earlier-declared broader one', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/*rest'}, {path: '/a', children: [{path: '/b'}]}]
        },
        history,
        () => Promise.resolve(null)
      );
      // Both chains match `/a/b`; the static one wins although the
      // wildcard is declared first.
      const matched = match(router, '/a/b');
      matched!.length.should.equal(3);
      matched![1].route.path.should.equal('/a');
      matched![1].path.should.equal('/a');
      matched![2].path.should.equal('/b');
    });

    it('should rank static over dynamic segments regardless of declaration order', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/users/:id'}, {path: '/users/new'}]
        },
        history,
        () => Promise.resolve(null)
      );
      match(router, '/users/new')![1].route.path.should.equal('/users/new');
      match(router, '/users/42')![1].route.path.should.equal('/users/:id');
    });

    it('should rank deeper static chains over shallower dynamic ones', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/posts/:author/:slug'}, {path: '/posts/archive'}]
        },
        history,
        () => Promise.resolve(null)
      );
      // 3 static segments (30) beat 1 static + 2 dynamic (16).
      match(router, '/posts/archive')![1].route.path.should.equal(
        '/posts/archive'
      );
      match(router, '/posts/alice/intro')![1].route.path.should.equal(
        '/posts/:author/:slug'
      );
    });

    it('should keep declaration order for equally specific chains', () => {
      const history = createMemoryHistory();
      const router = create(
        {path: '', children: [{path: '/:x'}, {path: '/:y'}]},
        history,
        () => Promise.resolve(null)
      );
      match(router, '/q')![1].route.path.should.equal('/:x');
    });

    it('should keep matching results stable across repeated calls', () => {
      const history = createMemoryHistory();
      const router = create(
        {path: '', children: [{path: '/users/:id'}, {path: '/users/new'}]},
        history,
        () => Promise.resolve(null)
      );
      const first = match(router, '/users/new');
      const second = match(router, '/users/new');
      second!.length.should.equal(first!.length);
      second![1].route.should.equal(first![1].route);
      ({...second![1].params}).should.deepEqual({...first![1].params});
    });

    // ExtractPathParams 按 path-to-regexp 8.4.2 字符串语法建模
    it('should model path params of the path-to-regexp 8.4.2 grammar', () => {
      // :name 与段内前缀/后缀静态文本、多参数
      expectTypeOf<ExtractPathParams<'/users/:id'>>().toEqualTypeOf<{
        id: string;
      }>();
      expectTypeOf<ExtractPathParams<'/page-:id'>>().toEqualTypeOf<{
        id: string;
      }>();
      expectTypeOf<ExtractPathParams<'/page-:id-end'>>().toEqualTypeOf<{
        id: string;
      }>();
      // 多参数产出交叉类型（TS 不折叠对象交叉）
      expectTypeOf<ExtractPathParams<'/:from-:to'>>().toEqualTypeOf<
        {from: string} & {to: string}
      >();

      // 通配符 → string[]（含文本后嵌入的形式）
      expectTypeOf<ExtractPathParams<'/files/*rest'>>().toEqualTypeOf<{
        rest: string[];
      }>();
      expectTypeOf<ExtractPathParams<'/file*rest'>>().toEqualTypeOf<{
        rest: string[];
      }>();

      // v6 遗留后缀：8.4.2 编译期即抛 PathError，一律不产出键
      expectTypeOf<ExtractPathParams<'/users/:id?'>>().toEqualTypeOf<{}>();
      expectTypeOf<ExtractPathParams<'/users/:id*'>>().toEqualTypeOf<{}>();
      expectTypeOf<ExtractPathParams<'/users/:id+'>>().toEqualTypeOf<{}>();
      expectTypeOf<ExtractPathParams<'/users/:id(\\d+)'>>().toEqualTypeOf<{}>();

      // 静态段与空名（`:9x`、裸 `:` 运行时抛 Missing parameter name）
      expectTypeOf<ExtractPathParams<'/a/b'>>().toEqualTypeOf<{}>();
      expectTypeOf<ExtractPathParams<'/:9x'>>().toEqualTypeOf<{}>();
      expectTypeOf<ExtractPathParams<'/:'>>().toEqualTypeOf<{}>();

      // 转义冒号是静态文本，不是参数
      expectTypeOf<ExtractPathParams<'/a\\:b/:id'>>().toEqualTypeOf<{
        id: string;
      }>();
    });
  });

  describe('resolveTo', () => {
    it('should resolve a path', () => {
      const history = createMemoryHistory();
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        (matched) => Promise.resolve(matched.at(-1)!.path)
      );
      return resolveTo(router, '/bar').then((path) => {
        path.should.be.equal('/bar');
      });
    });
  });

  describe('context', () => {
    it('should hand the instance context to guards and resolveView', async () => {
      const api = {user: 'u1'};
      const seen: {guard?: unknown; view?: unknown} = {};
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {
          path: '',
          children: [
            {
              path: '/a',
              beforeLoad: ({context}) => {
                seen.guard = context;
              }
            }
          ]
        },
        history,
        (matched, {context}) => {
          seen.view = context;
          return Promise.resolve(matched.at(-1)!.path);
        },
        {context: api}
      );

      (router.context === api).should.be.true();
      await navigate(router, '/a');
      seen.guard!.should.be.exactly(api);
      seen.view!.should.be.exactly(api);
    });

    it('should keep the context undefined on both ctxs without the option', async () => {
      const seen: {guard?: unknown; view?: unknown} = {};
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {
          path: '',
          children: [
            {
              path: '/a',
              beforeLoad: ({context}) => {
                seen.guard = context;
              }
            }
          ]
        },
        history,
        (matched, {context}) => {
          seen.view = context;
          return Promise.resolve(matched.at(-1)!.path);
        }
      );

      (router.context === undefined).should.be.true();
      await navigate(router, '/a');
      (seen.guard === undefined).should.be.true();
      (seen.view === undefined).should.be.true();
    });

    it('should isolate the context between two router instances', async () => {
      const seen: string[] = [];
      const make = (tag: string) =>
        create(
          {path: '', children: [{path: '/a'}]},
          createMemoryHistory({initialEntries: ['/']}),
          (matched, {context}) => {
            seen.push(`${tag}:${(context as unknown as {tag: string}).tag}`);
            return Promise.resolve(null);
          },
          {context: {tag}}
        );

      const a = make('a');
      const b = make('b');
      await navigate(a, '/a');
      await navigate(b, '/a');
      seen.should.deepEqual(['a:a', 'b:b']);
    });
  });

  describe('navigate', () => {
    it('should navigate to a new path', () => {
      const history = createMemoryHistory();
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        (matched) => Promise.resolve(matched.at(-1)!.path)
      );
      return navigate(router, '/bar').then(() => {
        history.location.pathname.should.be.equal('/bar');
      });
    });

    it('should clear the in-flight mark once the navigation settles', async () => {
      const statuses: (string | undefined)[] = [];
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {path: '', children: [{path: '/'}, {path: '/a'}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
        {onLoadingChange: (status) => statuses.push(status)}
      );

      // A settled navigation is no longer in flight.
      await navigate(router, '/a');
      (router.resolving === undefined).should.be.true();

      // A rejected navigation clears the mark too.
      try {
        await navigate(router, '/missing');
      } catch {
        // NotFoundError, expected.
      }
      (router.resolving === undefined).should.be.true();

      // Neither settled navigation leaves a stale mark behind: the last
      // navigation fires no spurious cancel signal at its start.
      await navigate(router, '/b');
      statuses.should.deepEqual([
        'pending',
        'resolved',
        'pending',
        'rejected',
        'pending',
        'resolved'
      ]);
    });

    it('should abort the superseded navigation chain but not the new one', async () => {
      const signals: [string, AbortSignal][] = [];
      const park = new Promise<undefined>(() => {});
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {
          path: '',
          children: [
            {path: '/'},
            {
              path: '/a',
              beforeLoad({signal}) {
                signals.push(['guard:/a', signal]);
                // Slow guard: never settles on its own.
                return park;
              }
            },
            {
              path: '/b',
              beforeLoad({signal}) {
                signals.push(['guard:/b', signal]);
              }
            }
          ]
        },
        history,
        (matched, {signal}) => {
          signals.push([`view:${matched.at(-1)!.path}`, signal]);
          return Promise.resolve(`view:${matched.at(-1)!.path}`);
        }
      );

      // The parked chain of /a is superseded by /b.
      navigate(router, '/a').catch(() => undefined);
      await navigate(router, '/b');

      const byName = (name: string) => signals.find(([n]) => n === name)![1];
      // Aborting is synchronous with the superseding navigation.
      byName('guard:/a').aborted.should.be.true();
      // The new chain's guard and view signals stay live.
      byName('guard:/b').aborted.should.be.false();
      byName('view:/b').aborted.should.be.false();
      history.location.pathname.should.equal('/b');
    });

    it('should not abort the signal of an already settled navigation', async () => {
      const viewSignals: AbortSignal[] = [];
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        (matched, {signal}) => {
          viewSignals.push(signal);
          return Promise.resolve(`view:${matched.at(-1)!.path}`);
        }
      );

      await navigate(router, '/a');
      await navigate(router, '/b');
      // The superseded chain had already committed: its contexts must not
      // report a bogus `aborted` after the fact.
      viewSignals.should.have.length(2);
      viewSignals[0]!.aborted.should.be.false();
      viewSignals[1]!.aborted.should.be.false();
    });
  });

  describe('refresh', () => {
    it('should refresh the page', () => {
      let count = 0;
      const history = createMemoryHistory();
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        (matched) => Promise.resolve([matched.at(-1)!.path, ++count])
      );
      return navigate(router, '/bar')
        .then(() => {
          history.location.pathname.should.be.equal('/bar');
          count.should.be.equal(1);
          router.viewStack[1].should.be.deepEqual(['/bar', 1]);
        })
        .then(() => refresh(router))
        .then(() => {
          history.location.pathname.should.be.equal('/bar');
          count.should.be.equal(2);
          // router.viewStack.length.should.be.eql(1);
          router.viewStack[1].should.be.deepEqual(['/bar', 2]);
          // The replace keeps the index.
          (history.location.state as HistoryState).index.should.equal(1);
        });
    });
  });

  describe('go', () => {
    it('should navigate in history stack', async () => {
      const tick = () =>
        new Promise((done) => {
          setTimeout(done);
        });
      const history = createMemoryHistory({initialEntries: ['/foo']});
      let count = 0;
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}:${++count}`)
      );
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]},
        history,
        resolveView
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/bar');
      await navigate(router, '/baz');
      // The initial warm-up refresh plus the two navigations.
      resolveView.callCount.should.equal(3);

      // A two-slot back POP lands on /foo through the viewStack snapshot:
      // listen fires with the committed view, zero new resolves.
      go(router, -2);
      history.location.pathname.should.equal('/foo');
      views.at(-1)!.should.equal('view:/foo:1');
      resolveView.callCount.should.equal(3);

      // A one-slot forward POP hits the /bar snapshot the same way.
      go(router, 1);
      history.location.pathname.should.equal('/bar');
      views.at(-1)!.should.equal('view:/bar:2');
      resolveView.callCount.should.equal(3);

      // The in-memory window survived both POPs untouched.
      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar', '/baz']);
      router.viewStack.should.deepEqual([
        'view:/foo:1',
        'view:/bar:2',
        'view:/baz:3'
      ]);
    });
  });

  describe('forward', () => {
    it('should forward in history stack', async () => {
      const tick = () =>
        new Promise((done) => {
          setTimeout(done);
        });
      const history = createMemoryHistory({initialEntries: ['/foo']});
      let count = 0;
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}:${++count}`)
      );
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        resolveView
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/bar');
      // The warm-up refresh plus one navigation.
      resolveView.callCount.should.equal(2);

      back(router);
      history.location.pathname.should.equal('/foo');
      views.at(-1)!.should.equal('view:/foo:1');

      // The forward POP re-serves the committed /bar view from the
      // viewStack snapshot without a new resolve.
      forward(router);
      history.location.pathname.should.equal('/bar');
      views.at(-1)!.should.equal('view:/bar:2');
      resolveView.callCount.should.equal(2);
      (history.location.state as HistoryState).index.should.equal(1);
    });
  });

  describe('back', () => {
    it('should go back in history stack', async () => {
      const tick = () =>
        new Promise((done) => {
          setTimeout(done);
        });
      const history = createMemoryHistory({initialEntries: ['/foo']});
      let count = 0;
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}:${++count}`)
      );
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        resolveView
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/bar');
      resolveView.callCount.should.equal(2);

      // The back POP lands on the previous entry and serves its committed
      // view from the viewStack snapshot: listen fires, zero new resolves.
      back(router);
      history.location.pathname.should.equal('/foo');
      views.at(-1)!.should.equal('view:/foo:1');
      resolveView.callCount.should.equal(2);

      // The POP synced the current window into the landed entry, so a
      // later refresh still restores the whole in-window stack.
      const state = history.location.state as HistoryState;
      state.index.should.equal(0);
      state.base!.should.equal(0);
      state
        .locationStack!.map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar']);
      router.viewStack.should.deepEqual(['view:/foo:1', 'view:/bar:2']);
    });
  });

  describe('createHref', () => {
    it('should create href of a route path', async () => {
      const tick = () =>
        new Promise((done) => {
          setTimeout(done);
        });
      const history = createMemoryHistory({initialEntries: ['/app/foo']});
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
        {baseUrl: '/app'}
      );
      listen(router, () => undefined);
      await tick();

      // The baseUrl prefixes history's own href; search and hash ride along.
      createHref(router, '/bar').should.equal('/app/bar');
      createHref(router, '/bar?x=1').should.equal('/app/bar?x=1');
      createHref(router, '/bar?x=1#top').should.equal('/app/bar?x=1#top');

      // Round-trip with toLocation: the href points back at the same
      // pathname the router would commit for the same `to`.
      const location = toLocation(router, '/bar?x=1#top');
      location.pathname.should.equal('/app/bar');
      createHref(router, '/bar?x=1#top').should.equal(
        location.pathname + location.search + location.hash
      );
    });
  });

  describe('cancel', () => {
    const tick = () =>
      new Promise((done) => {
        setTimeout(done);
      });

    it('should cancel the current navigate', async () => {
      const park = new Promise<undefined>(() => {});
      const guardSignals: AbortSignal[] = [];
      const viewSignals: AbortSignal[] = [];
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {
          path: '',
          children: [
            {path: '/'},
            {
              path: '/slow',
              beforeLoad({signal}) {
                guardSignals.push(signal);
                // Slow guard: never settles on its own.
                return park;
              }
            }
          ]
        },
        history,
        (matched, {signal}) => {
          viewSignals.push(signal);
          return Promise.resolve(`view:${matched.at(-1)!.path}`);
        }
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      // listen's initial replace lazily warms the current entry up.
      const viewsBefore = [...views];
      viewsBefore.at(-1)!.should.equal('view:/');

      let settled = false;
      const inflight = navigate(router, '/slow').then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      (router.resolving !== undefined).should.be.true();

      cancel(router);

      // The cancelled chain's promise never settles: race it against a
      // short timer a few times to prove neither fulfillment nor
      // rejection fires.
      for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop -- each round must observe the timer's non-settlement before the next
        await Promise.race([inflight, tick()]);
        settled.should.be.false();
        // eslint-disable-next-line no-await-in-loop -- settle the timer before the next observation round
        await tick();
      }

      // The in-flight mark is gone and the guard's signal was aborted
      // synchronously with cancel().
      (router.resolving === undefined).should.be.true();
      guardSignals.should.have.length(1);
      guardSignals[0]!.aborted.should.be.true();

      // The parked chain never reached its view phase(the only view
      // task is the warm-up refresh's), and no view was announced.
      viewSignals.should.have.length(1);
      history.location.pathname.should.equal('/');
      views.should.deepEqual(viewsBefore);

      // A later navigation works normally on the clean router.
      await navigate(router, '/');
      history.location.pathname.should.equal('/');
      views.at(-1)!.should.equal('view:/');
      (router.resolving === undefined).should.be.true();
    });

    it('should clear the in-flight mark so a later navigate fires no spurious cancel signal', async () => {
      const statuses: (string | undefined)[] = [];
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {
          path: '',
          children: [
            {path: '/'},
            {
              path: '/guarded',
              async beforeLoad() {
                await tick();
                await tick();
              }
            }
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
        {onLoadingChange: (status) => statuses.push(status)}
      );

      // The cancelled chain parks forever; its in-flight mark must go.
      navigate(router, '/guarded').catch(() => undefined);
      statuses.should.deepEqual(['pending']);
      cancel(router);
      (router.resolving === undefined).should.be.true();

      // The next navigation starts clean — no spurious `onLoadingChange()`
      // (undefined status) for the dead resolve.
      await navigate(router, '/');
      statuses.should.deepEqual(['pending', undefined, 'pending', 'resolved']);
    });

    it('should abort the in-flight chain signal of guards and view loaders', async () => {
      const guardSignals: AbortSignal[] = [];
      const viewSignals: AbortSignal[] = [];
      const park = new Promise<undefined>(() => {});
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {
          path: '',
          children: [
            {path: '/'},
            {
              path: '/guarded',
              beforeLoad({signal}) {
                guardSignals.push(signal);
                return park;
              }
            }
          ]
        },
        history,
        (matched, {signal}) => {
          viewSignals.push(signal);
          return Promise.resolve(`view:${matched.at(-1)!.path}`);
        }
      );

      // navigate() only starts the chain; the guard runs on the next
      // microtask(await resume) of the async resolveEntry.
      navigate(router, '/guarded').catch(() => undefined);
      await Promise.resolve();
      cancel(router);
      guardSignals[0]!.aborted.should.be.true();

      // A later navigation gets a fresh, live signal.
      await navigate(router, '/');
      guardSignals.should.have.length(1);
      viewSignals[0]!.aborted.should.be.false();
    });
  });

  describe('listen', () => {
    const tick = () =>
      new Promise((done) => {
        setTimeout(done);
      });

    it('should show the committed view after a back POP and keep the serialized window bounded', async () => {
      const history = createMemoryHistory({initialEntries: ['/foo']});
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/bar');
      const state = history.location.state as HistoryState;
      // The state carries the index, the user state and a bounded window
      // of the location stack, never an unbounded stack.
      state.index.should.equal(1);
      Should(state.state).be.undefined();
      state
        .locationStack!.map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar']);
      (state.locationStack!.length <= 100).should.be.true();

      go(router, -1);
      history.location.pathname.should.equal('/foo');
      views.at(-1)!.should.equal('view:/foo');
    });

    // listen 回调的第二个参数：导航落位方式与导航途径匹配。
    it('should report the navigation action alongside the view', async () => {
      const history = createMemoryHistory({initialEntries: ['/foo']});
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const events: [string, NavAction][] = [];
      listen(router, (v, action) => events.push([v as string, action]));
      await tick();
      // 丢弃 listen 的初始预热 replace 与其惰性重解析落位。
      events.length = 0;

      await navigate(router, '/bar');
      events.should.deepEqual([['view:/bar', 'push']]);
      events.length = 0;

      go(router, -1);
      // POP 命中快照：先以 'pop' 上报；随后窗口同步的 replace 对同一视图
      // 再报一次（视图不变，仅状态同步）。
      events.should.deepEqual([
        ['view:/foo', 'pop'],
        ['view:/foo', 'replace']
      ]);
      events.length = 0;

      go(router, 1);
      events.should.deepEqual([
        ['view:/bar', 'pop'],
        ['view:/bar', 'replace']
      ]);
      events.length = 0;

      await refresh(router);
      events.should.deepEqual([['view:/bar', 'replace']]);
      events.length = 0;

      // 被拦截的 POP：否决本身不上报；回摆落位以 'pop' 重新宣告当前视图。
      // BlockerFn 语义是「放行」谓词——返回 false 即否决。
      setBlocker(router, () => false);
      go(router, -1);
      await tick();
      events.should.deepEqual([['view:/bar', 'pop']]);
    });

    it('should refresh when forwarding to an entry whose view is not resolved', async () => {
      const history = createMemoryHistory({initialEntries: ['/foo']});
      history.push('/bar', {index: 1});
      history.push('/baz', {index: 2});
      let count = 0;
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}:${++count}`),
        {currentView: 'view:/baz:0'}
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      // The current view is provided(e.g. SSR), nothing resolved yet.
      count.should.equal(0);

      go(router, -2);
      await tick();
      history.location.pathname.should.equal('/foo');
      views.at(-1)!.should.equal('view:/foo:1');

      // Forward to /bar(index 1): never resolved in this session.
      go(router, 1);
      await tick();
      history.location.pathname.should.equal('/bar');
      views.at(-1)!.should.equal('view:/bar:2');
      (history.location.state as HistoryState).index.should.equal(1);
      // The lazy refresh restarted the window at the landed slot; the
      // refresh replaced in place, the index did not change.
      router.viewStack.length.should.equal(1);
      router.viewStack[0]!.should.equal('view:/bar:2');
    });

    it('should keep the index when replacing, so a back POP still lands on the previous entry', async () => {
      const history = createMemoryHistory({initialEntries: ['/foo']});
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/bar');
      await refresh(router);
      (history.location.state as HistoryState).index.should.equal(1);

      go(router, -1);
      history.location.pathname.should.equal('/foo');
      views.at(-1)!.should.equal('view:/foo');
    });

    it('should sync the serialized window into the landed entry on POP', async () => {
      const history = createMemoryHistory({initialEntries: ['/foo']});
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/bar');
      await navigate(router, '/baz');
      go(router, -2);
      history.location.pathname.should.equal('/foo');
      views.at(-1)!.should.equal('view:/foo');

      // The initial entry had no state of its own; the POP wrote the
      // current window back into it, so a refresh here still restores
      // the whole in-window stack.
      const state = history.location.state as HistoryState;
      state.index.should.equal(0);
      state.base!.should.equal(0);
      state
        .locationStack!.map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar', '/baz']);
    });

    it('should let a POP cancel a navigation still running its guards', async () => {
      const history = createMemoryHistory({
        initialEntries: ['/a', '/b'],
        initialIndex: 1
      });
      const router = create(
        {
          path: '',
          children: [
            {path: '/a'},
            {path: '/b'},
            {
              path: '/guarded',
              async beforeLoad() {
                await tick();
                await tick();
              }
            }
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      listen(router, () => undefined);
      await tick();

      navigate(router, '/guarded').catch(() => undefined);
      go(router, -1);
      await tick();
      await tick();
      await tick();

      // The POP cancelled the guarded navigation: the slow guards
      // finishing later must not push over the landed entry.
      history.location.pathname.should.equal('/a');
    });

    it('should not produce an unhandled rejection when a guard fails in the lazy refresh path', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const history = createMemoryHistory({initialEntries: ['/guarded']});
        const router = create(
          {
            path: '',
            children: [
              {
                path: '/guarded',
                beforeLoad() {
                  throw new Error('guard boom');
                }
              }
            ]
          },
          history,
          () => Promise.resolve(null)
        );
        listen(router, () => undefined);
        await tick();
        await tick();

        unhandled.should.deepEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  describe('locationStack', () => {
    it('should keep the session memory stack with slice semantics on branch navigations', async () => {
      const history = createMemoryHistory({initialEntries: ['/foo']});
      const router = create(
        {
          path: '',
          children: [
            {path: '/foo'},
            {path: '/bar'},
            {path: '/baz'},
            {path: '/qux'}
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      // The initial entry carries no serialized window, so creation
      // degrades to a single-entry memory stack.
      router.locationStack.map((l) => l.pathname).should.deepEqual(['/foo']);

      await navigate(router, '/bar', {id: 1});
      await navigate(router, '/baz');
      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar', '/baz']);
      // The user state of the location is kept on the stack entry.
      router.locationStack[1].state.should.deepEqual({id: 1});

      // Back to /bar(index 1), then a branch navigate truncates the
      // forward entries and appends, like viewStack does.
      back(router);
      history.location.pathname.should.equal('/bar');
      await navigate(router, '/qux');
      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar', '/qux']);
      router.viewStack.length.should.equal(3);
      // Index 0 stays null without listen(); the navigated entries are
      // in sync with the location stack.
      router.viewStack[2].should.equal('view:/qux');
    });

    it('should update locationStack[index] in place when replacing', async () => {
      const history = createMemoryHistory({initialEntries: ['/foo']});
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      await navigate(router, '/bar');

      const location = toLocation(router, '/baz');
      await commitReplace(router, resolve(router, location), location);

      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/foo', '/baz']);
      // Only index 1 was replaced in place, index 0 is untouched.
      router.viewStack[1].should.equal('view:/baz');
      (router.viewStack[0] === null).should.be.true();
      // The replace keeps the index.
      (history.location.state as HistoryState).index.should.equal(1);
    });

    it('should keep the serialized window bounded after push and replace', async () => {
      const history = createMemoryHistory({initialEntries: ['/foo']});
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      await navigate(router, '/bar', {custom: 's'});
      // The serialized state contains the index, the user state and a
      // bounded window of the location stack, never an unbounded stack.
      const pushed = history.location.state as HistoryState;
      pushed.index.should.equal(1);
      pushed.state.should.deepEqual({custom: 's'});
      pushed.base!.should.equal(0);
      pushed
        .locationStack!.map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar']);

      await navigate(router, '/baz');
      const pushedAgain = history.location.state as HistoryState;
      pushedAgain.index.should.equal(2);
      Should(pushedAgain.state).be.undefined();
      pushedAgain
        .locationStack!.map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar', '/baz']);
      // The window never exceeds maxStackDepth(default 100).
      (
        pushedAgain.locationStack!.length <= router.maxStackDepth
      ).should.be.true();
      router.locationStack.length.should.equal(3);

      await refresh(router);
      const replaced = history.location.state as HistoryState;
      replaced.index.should.equal(2);
      replaced.base!.should.equal(0);
      replaced
        .locationStack!.map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar', '/baz']);
      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar', '/baz']);
    });

    describe('serialization window', () => {
      const tick = () =>
        new Promise((done) => {
          setTimeout(done);
        });

      it('should cap the window at maxStackDepth and evict the oldest entries', async () => {
        const history = createMemoryHistory({initialEntries: ['/a']});
        const router = create(
          {
            path: '',
            children: [
              {path: '/a'},
              {path: '/b'},
              {path: '/c'},
              {path: '/d'},
              {path: '/e'}
            ]
          },
          history,
          (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
          {maxStackDepth: 3}
        );
        // Five entries in the session: /a plus four navigations.
        await navigate(router, '/b');
        await navigate(router, '/c');
        await navigate(router, '/d');
        await navigate(router, '/e');

        const state = history.location.state as HistoryState;
        state.index.should.equal(4);
        state.locationStack!.length.should.equal(3);
        state
          .locationStack!.map((l) => l.pathname)
          .should.deepEqual(['/c', '/d', '/e']);
        // The window starts at absolute index 2: /a and /b are evicted.
        state.base!.should.equal(2);
        // The in-memory window is bounded too: it mirrors the serialized
        // window exactly, and the base records the eviction offset.
        router.locationStack
          .map((l) => l.pathname)
          .should.deepEqual(['/c', '/d', '/e']);
        (router as any).baseIndex.should.equal(2);
        router.viewStack.length.should.equal(3);

        // A replace keeps the window capped as well.
        await refresh(router);
        const replaced = history.location.state as HistoryState;
        replaced.locationStack!.length.should.equal(3);
        replaced.base!.should.equal(2);
      });

      it('should restore a windowed stack and lazily refresh out-of-window slots', async () => {
        const history1 = createMemoryHistory({initialEntries: ['/a']});
        const router1 = create(
          {
            path: '',
            children: [{path: '/a'}, {path: '/b'}, {path: '/c'}, {path: '/d'}]
          },
          history1,
          (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
          {maxStackDepth: 2}
        );
        await navigate(router1, '/b');
        const stateB = history1.location.state;
        await navigate(router1, '/c');
        // The window holds only [/b, /c] with base 1: /a is evicted.
        const stateC = history1.location.state as HistoryState;
        stateC.base!.should.equal(1);

        // Refresh: only the in-window entries are replayed.
        const history2 = createMemoryHistory({
          initialEntries: [
            '/a',
            {pathname: '/b', state: stateB},
            {pathname: '/c', state: stateC}
          ]
        });
        let count = 0;
        const router2 = create(
          {
            path: '',
            children: [{path: '/a'}, {path: '/b'}, {path: '/c'}, {path: '/d'}]
          },
          history2,
          (matched) =>
            Promise.resolve(`view2:${matched.at(-1)!.path}:${++count}`)
        );
        // The memory window is restored as-is, window-relative.
        router2.locationStack
          .map((l) => l.pathname)
          .should.deepEqual(['/b', '/c']);
        (router2 as any).baseIndex.should.equal(1);
        router2.viewStack.length.should.equal(2);

        const views: string[] = [];
        listen(router2, (v) => views.push(v as string));
        await tick();
        // listen()'s initial lazy refresh of the current entry.
        count.should.equal(1);

        await initHistoryStack(router2);
        // Every in-window entry was warmed.
        count.should.equal(3);
        router2.viewStack.should.deepEqual(['view2:/b:2', 'view2:/c:3']);

        // In-window back is warmed: zero new resolves.
        go(router2, -1);
        history2.location.pathname.should.equal('/b');
        await tick();
        count.should.equal(3);
        views.at(-1)!.should.equal('view2:/b:2');

        // Back onto the evicted(out-of-window) slot lazily refreshes
        // the entry and restarts the window at the landed position.
        go(router2, -1);
        history2.location.pathname.should.equal('/a');
        await tick();
        count.should.equal(4);
        views.at(-1)!.should.equal('view2:/a:4');
        (router2 as any).baseIndex.should.equal(0);
      });

      it('should degrade to a single-entry stack for legacy index-only state', () => {
        const history = createMemoryHistory({
          initialEntries: [{pathname: '/baz', state: {index: 2}}]
        });
        const router = create(
          {
            path: '',
            children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]
          },
          history,
          (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
        );
        // Legacy 1.x shape({index} without a window) is still accepted:
        // the memory window degrades to the current entry, aligned with
        // the landed position, and the view stack stays window-relative.
        router.locationStack.map((l) => l.pathname).should.deepEqual(['/baz']);
        (router as any).baseIndex.should.equal(2);
        router.viewStack.length.should.equal(1);
        router.viewStack.every((v) => v == null).should.be.true();
      });
    });
  });

  describe('initHistoryStack', () => {
    const tick = () =>
      new Promise((done) => {
        setTimeout(done);
      });

    it('should re-resolve every in-memory entry so a POP switches views without new resolves', async () => {
      const history = createMemoryHistory({initialEntries: ['/foo']});
      let count = 0;
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}:${++count}`)
      );
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]},
        history,
        resolveView
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/bar');
      await navigate(router, '/baz');
      // The initial refresh of listen plus two navigations.
      resolveView.callCount.should.equal(3);

      await initHistoryStack(router);
      resolveView.callCount.should.equal(6);
      router.viewStack.should.deepEqual([
        'view:/foo:4',
        'view:/bar:5',
        'view:/baz:6'
      ]);

      go(router, -1);
      history.location.pathname.should.equal('/bar');
      views.at(-1)!.should.equal('view:/bar:5');
      // The POP reused the re-resolved view without a new resolve.
      resolveView.callCount.should.equal(6);
    });

    it('should restore the serialized window after a refresh and warm it up for zero-request navigation', async () => {
      const history1 = createMemoryHistory({initialEntries: ['/foo']});
      const router1 = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]},
        history1,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      await navigate(router1, '/bar');
      await navigate(router1, '/baz');

      // Simulate a refresh: a new history replaying the in-window
      // entries, the landed one carrying its serialized state — exactly
      // what a browser reload restores.
      const history2 = createMemoryHistory({
        initialEntries: [
          '/foo',
          '/bar',
          {pathname: history1.location.pathname, state: history1.location.state}
        ]
      });
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view2:${matched.at(-1)!.path}`)
      );
      const router2 = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}, {path: '/baz'}]},
        history2,
        resolveView
      );

      // The window is restored aligned with the view stack. Nothing is
      // resolved yet, so the current view is empty.
      router2.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar', '/baz']);
      router2.viewStack.length.should.equal(3);
      (getCurrentView(router2) === null).should.be.true();

      const views: string[] = [];
      listen(router2, (v) => views.push(v as string));
      await tick();
      // Only listen()'s initial lazy refresh resolved the current entry.
      resolveView.callCount.should.equal(1);

      await initHistoryStack(router2);
      resolveView.callCount.should.equal(4);
      router2.viewStack.should.deepEqual([
        'view2:/foo',
        'view2:/bar',
        'view2:/baz'
      ]);

      // In-window back: the warmed view switches in with zero resolves.
      go(router2, -2);
      history2.location.pathname.should.equal('/foo');
      views.at(-1)!.should.equal('view2:/foo');
      resolveView.callCount.should.equal(4);

      // The POP also wrote the window back into the landed entry, so
      // yet another refresh here would still restore the stack.
      const state = history2.location.state as HistoryState;
      state.index.should.equal(0);
      state
        .locationStack!.map((l) => l.pathname)
        .should.deepEqual(['/foo', '/bar', '/baz']);
    });
  });

  describe('invalidate', () => {
    const tick = () =>
      new Promise((done) => {
        setTimeout(done);
      });

    it('should re-run the guard and the loader of the landed entry on a back POP', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const beforeLoad = sinon.fake.resolves(undefined);
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a', beforeLoad}, {path: '/b'}]},
        history,
        resolveView
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/b');
      // listen's initial lazy refresh of /a plus the pushed /b.
      beforeLoad.callCount.should.equal(1);
      resolveView.callCount.should.equal(2);

      invalidate(router);
      // Every snapshot is gone, but the window shape survives.
      router.viewStack.should.deepEqual([null, null]);

      go(router, -1);
      await tick();
      await tick();
      history.location.pathname.should.equal('/a');
      // The POP hit no snapshot and fell back to the lazy re-resolve
      // path — the same one out-of-window entries take — so both the
      // guard and the loader ran again on the landed entry.
      beforeLoad.callCount.should.equal(2);
      resolveView.callCount.should.equal(3);
      views.at(-1)!.should.equal('view:/a');
    });

    it('should serve a back POP from the viewStack without invalidate', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        resolveView
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/b');
      resolveView.callCount.should.equal(2);

      // No invalidate: the POP lands on the cached view with zero
      // requests — the contrast to the case above.
      go(router, -1);
      history.location.pathname.should.equal('/a');
      views.at(-1)!.should.equal('view:/a');
      resolveView.callCount.should.equal(2);
    });

    it('should re-apply a guard redirect on a back POP after invalidate', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      let loggedOut = false;
      const router = create(
        {
          path: '',
          children: [
            {
              path: '/a',
              beforeLoad: () => (loggedOut ? '/login' : undefined)
            },
            {path: '/b'},
            {path: '/login'}
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/b');
      history.location.pathname.should.equal('/b');

      // Logout: drop the snapshots, then try to go back to /a.
      invalidate(router);
      loggedOut = true;
      go(router, -1);
      await tick();
      await tick();
      // The re-run guard redirected the landed entry, so the previous
      // account's view is never restored.
      history.location.pathname.should.equal('/login');
      views.at(-1)!.should.equal('view:/login');
    });

    it('should leave the current view untouched by invalidate', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        resolveView
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();

      await navigate(router, '/b');
      const viewCount = views.length;
      const resolveCount = resolveView.callCount;

      invalidate(router);
      await tick();
      await tick();
      // Neither re-resolved nor re-emitted: the rendered view stays.
      resolveView.callCount.should.equal(resolveCount);
      views.length.should.equal(viewCount);
      history.location.pathname.should.equal('/b');
    });
  });

  describe('mergeMatchedParams', () => {
    it('should merge params of all matched levels', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/users/:id', children: [{path: '/posts/:postId'}]}]
        },
        history,
        () => Promise.resolve(null)
      );
      const matched = match(router, '/users/123/posts/456');
      matched!.length.should.equal(3);
      mergeMatchedParams(matched!).should.deepEqual({
        id: '123',
        postId: '456'
      });
    });

    it('should let deeper levels override same-name params', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/:id', children: [{path: '/posts/:id'}]}]
        },
        history,
        () => Promise.resolve(null)
      );
      mergeMatchedParams(match(router, '/42/posts/99')!).should.deepEqual({
        id: '99'
      });
    });

    it('should return an empty object for an empty array', () => {
      mergeMatchedParams([]).should.deepEqual({});
    });

    it('should merge only up to `end` when given', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/users/:id', children: [{path: '/posts/:postId'}]}]
        },
        history,
        () => Promise.resolve(null)
      );
      const matched = match(router, '/users/123/posts/456')!;
      // Level 0 sees only its own params.
      mergeMatchedParams(matched, 0).should.deepEqual({});
      // Level 1 accumulates root + itself; the deeper postId must not
      // leak into the shallower context.
      mergeMatchedParams(matched, 1).should.deepEqual({id: '123'});
      // The deepest level sees the full accumulation.
      mergeMatchedParams(matched, 2).should.deepEqual({
        id: '123',
        postId: '456'
      });
    });

    it('should keep the same-name override semantics within `end`', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/:id', children: [{path: '/posts/:id'}]}]
        },
        history,
        () => Promise.resolve(null)
      );
      const matched = match(router, '/42/posts/99')!;
      // Before the overriding level is included, the shallow value stays.
      mergeMatchedParams(matched, 1).should.deepEqual({id: '42'});
      mergeMatchedParams(matched, 2).should.deepEqual({id: '99'});
    });

    it('should merge every level when `end` is omitted (backward compatible)', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/users/:id', children: [{path: '/posts/:postId'}]}]
        },
        history,
        () => Promise.resolve(null)
      );
      const matched = match(router, '/users/123/posts/456')!;
      // A single-argument call keeps the 1.x all-levels merge.
      mergeMatchedParams(matched).should.deepEqual(
        mergeMatchedParams(matched, matched.length - 1)
      );
      // An out-of-range `end` degrades to the full merge as well.
      mergeMatchedParams(matched, 99).should.deepEqual({
        id: '123',
        postId: '456'
      });
    });
  });

  describe('getParams', () => {
    it('should merge params of all matched levels in nested routes', () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/users/:id', children: [{path: '/posts/:postId'}]}]
        },
        history,
        (matched) => Promise.resolve(matched)
      );
      return navigate(router, '/users/123/posts/456').then(() => {
        getParams(router)!.should.deepEqual({id: '123', postId: '456'});
      });
    });

    it('should return the parsed params of the current location on a param route', async () => {
      const history = createMemoryHistory();
      const router = create(
        {path: '', children: [{path: '/users/:id'}]},
        history,
        () => Promise.resolve(null)
      );
      await navigate(router, '/users/123');
      getParams(router)!.should.deepEqual({id: '123'});
    });

    it('should let deeper params override same-name shallow params', async () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [{path: '/:id', children: [{path: '/posts/:id'}]}]
        },
        history,
        () => Promise.resolve(null)
      );
      await navigate(router, '/42/posts/99');
      getParams(router)!.should.deepEqual({id: '99'});
    });

    it('should return undefined when the current entry is outside the restored window', () => {
      const history = createMemoryHistory({
        initialEntries: [
          {
            pathname: '/users/5',
            state: {
              index: 0,
              base: 2,
              locationStack: [{pathname: '/a'}, {pathname: '/b'}]
            }
          }
        ]
      });
      const router = create(
        {
          path: '',
          children: [{path: '/users/:id'}, {path: '/a'}, {path: '/b'}]
        },
        history,
        () => Promise.resolve(null)
      );
      // The landed entry(index 0) precedes the restored window(base 2),
      // so its slot is out-of-window: the location is unknown to the
      // session and there is nothing to merge — `undefined`, the
      // out-of-band signal, not a silently wrong `{}`.
      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/a', '/b']);
      (router as any).baseIndex.should.equal(2);
      Should(getParams(router)).be.undefined();
    });

    it('should return an empty object when the current path matches no route', () => {
      const history = createMemoryHistory({initialEntries: ['/unknown']});
      const router = create(
        {path: '', children: [{path: '/users/:id'}]},
        history,
        () => Promise.resolve(null)
      );
      getParams(router)!.should.deepEqual({});
    });
  });

  describe('route guards', () => {
    const tick = () =>
      new Promise((done) => {
        setTimeout(done);
      });

    it('should follow a static redirect on navigate, committing the terminal location', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a', redirect: '/b'}, {path: '/b'}]},
        history,
        resolveView
      );
      await navigate(router, '/a', {id: 7});

      history.location.pathname.should.equal('/b');
      // Only the terminal target was resolved, never the redirecting route.
      resolveView.callCount.should.equal(1);
      resolveView.firstCall.args[0].at(-1).path.should.equal('/b');
      getCurrentView(router).should.equal('view:/b');
      // The stack holds the terminal location; the user state of the
      // original navigation is carried through the redirect.
      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/a', '/b']);
      (history.location.state as HistoryState).state.should.deepEqual({id: 7});
    });

    it('should redirect when beforeLoad returns a path', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const beforeLoad = sinon.fake.resolves('/b');
      const router = create(
        {path: '', children: [{path: '/a', beforeLoad}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      await navigate(router, '/a');

      beforeLoad.callCount.should.equal(1);
      history.location.pathname.should.equal('/b');
      getCurrentView(router).should.equal('view:/b');
    });

    it('should follow a redirect chain and commit only the terminal entry', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {
          path: '',
          children: [
            {path: '/a', redirect: '/b'},
            {path: '/b', redirect: '/c'},
            {path: '/c'}
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      await navigate(router, '/a');

      history.location.pathname.should.equal('/c');
      getCurrentView(router).should.equal('view:/c');
      // Intermediate targets are never committed to the session stack.
      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/a', '/c']);
      (history.location.state as HistoryState)
        .locationStack!.map((l) => l.pathname)
        .should.deepEqual(['/a', '/c']);
    });

    it('should throw RedirectLoopError when redirects never settle', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {
          path: '',
          children: [
            {path: '/a', redirect: '/b'},
            {path: '/b', redirect: '/a'}
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      let error: any;
      try {
        await navigate(router, '/a');
      } catch (e) {
        error = e;
      }
      Should(error).be.an.instanceOf(RedirectLoopError);
      Should(error).be.an.instanceOf(NativeRouterError);
      // Nothing was committed; the history stays on the initial entry.
      history.location.pathname.should.equal('/a');
      router.locationStack.length.should.equal(1);
    });

    it('should continue when beforeLoad returns undefined', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const beforeLoad = sinon.fake.resolves(undefined);
      const router = create(
        {path: '', children: [{path: '/a', beforeLoad}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      await navigate(router, '/a');

      beforeLoad.callCount.should.equal(1);
      history.location.pathname.should.equal('/a');
      getCurrentView(router).should.equal('view:/a');
    });

    it('should pass params accumulated up to the current level to beforeLoad', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const seen: Record<string, string>[] = [];
      const router = create(
        {
          path: '',
          children: [
            {
              path: '/:section',
              beforeLoad: ({params}) => {
                seen.push({...params});
              },
              children: [
                {
                  path: '/detail/:section',
                  beforeLoad: ({params}) => {
                    seen.push({...params});
                  }
                }
              ]
            }
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      await navigate(router, '/users/detail/posts');

      // The shallow guard sees only its own params; the deep guard sees
      // the accumulation with the same-name param overridden.
      seen.should.deepEqual([{section: 'users'}, {section: 'posts'}]);
    });

    it('should replace the current entry with the terminal location when refresh redirects', async () => {
      const history = createMemoryHistory({
        initialEntries: [{pathname: '/a', state: {index: 0}}]
      });
      const router = create(
        {path: '', children: [{path: '/a', redirect: '/b'}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      await refresh(router);

      history.location.pathname.should.equal('/b');
      // The replace keeps the index.
      (history.location.state as HistoryState).index.should.equal(0);
      router.locationStack.map((l) => l.pathname).should.deepEqual(['/b']);
      getCurrentView(router).should.equal('view:/b');
    });

    it('should keep the NotFoundError behavior for unmatched paths', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {path: '', children: [{path: '/a'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      let error: any;
      try {
        await navigate(router, '/missing');
      } catch (e) {
        error = e;
      }
      Should(error).be.an.instanceOf(NotFoundError);
      // Nothing was committed for a failed resolve.
      history.location.pathname.should.equal('/a');
    });

    it('should not run guards in resolve — stack locations are already terminal', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a', redirect: '/b'}, {path: '/b'}]},
        history,
        resolveView
      );
      // resolve()/resolveTo() bypass the guards: they resolve whatever
      // route matches the given location as-is.
      (await resolveTo(router, '/a')).should.equal('view:/a');
      await initHistoryStack(router);
      resolveView.callCount.should.equal(2);
      router.viewStack[0].should.equal('view:/a');
      history.location.pathname.should.equal('/a');
    });

    it('should redirect a deep-linked entry through the lazy refresh of listen', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {path: '', children: [{path: '/a', redirect: '/b'}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      listen(router, () => undefined);
      await tick();

      // The initial lazy refresh followed the redirect and settled on
      // the terminal entry without looping.
      history.location.pathname.should.equal('/b');
      (history.location.state as HistoryState).index.should.equal(0);
      getCurrentView(router).should.equal('view:/b');
    });

    it('should let the last-started navigation win while slow guards are pending', async () => {
      const history = createMemoryHistory();
      const router = create(
        {
          path: '',
          children: [
            {
              path: '/slow',
              async beforeLoad() {
                await tick();
                await tick();
              }
            },
            {path: '/fast'}
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );

      // The slow navigation never settles(superseded chains park forever);
      // only await the fast one, then let the slow guards finish.
      navigate(router, '/slow').catch(() => undefined);
      await navigate(router, '/fast');
      await tick();
      await tick();

      history.location.pathname.should.equal('/fast');
      getCurrentView(router).should.equal('view:/fast');
    });

    it('should cancel a navigation whose guards are still pending', async () => {
      const beforeLoad = sinon.fake(async () => {
        await tick();
        await tick();
      });
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {path: '', children: [{path: '/'}, {path: '/guarded', beforeLoad}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );

      navigate(router, '/guarded').catch(() => undefined);
      cancel(router);
      await tick();
      await tick();

      // The guard ran out, but the navigation was cancelled before it:
      // nothing was committed.
      beforeLoad.callCount.should.equal(1);
      history.location.pathname.should.equal('/');
      Should(getCurrentView(router)).be.null();
    });

    it('should report pending loading while guards are still running', async () => {
      const statuses: (string | undefined)[] = [];
      const history = createMemoryHistory({initialEntries: ['/']});
      const router = create(
        {
          path: '',
          children: [
            {path: '/'},
            {
              path: '/guarded',
              async beforeLoad() {
                await tick();
              }
            }
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
        {onLoadingChange: (status) => statuses.push(status)}
      );

      const task = navigate(router, '/guarded');
      // The pending status is reported from the start of the guard
      // phase, not only once the view task begins.
      statuses.should.deepEqual(['pending']);
      await task;
      statuses.should.deepEqual(['pending', 'resolved']);
    });
  });

  describe('setBlocker', () => {
    const tick = () =>
      new Promise((done) => {
        setTimeout(done);
      });

    it('should veto a navigate before the chain ever starts', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        resolveView
      );
      const asks: [string, string][] = [];
      const unblock = setBlocker(router, (to, from) => {
        asks.push([to, from]);
        return false;
      });

      // A vetoed navigate resolves immediately — not an error, and
      // unlike a cancelled navigation it does settle.
      await navigate(router, '/b?x=1#top');
      asks.should.deepEqual([['/b?x=1#top', '/a']]);
      history.location.pathname.should.equal('/a');
      router.locationStack.map((l) => l.pathname).should.deepEqual(['/a']);
      // No guard, no loader, no controller: nothing ever started.
      resolveView.callCount.should.equal(0);
      (router.resolving === undefined).should.be.true();

      // Releasing(doubly, idempotently) lets the navigation through.
      unblock();
      unblock();
      await navigate(router, '/b');
      history.location.pathname.should.equal('/b');
      resolveView.callCount.should.equal(1);
    });

    it('should let the first veto short-circuit the later blockers', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const calls: string[] = [];
      setBlocker(router, (to) => {
        calls.push(`one:${to}`);
        return true;
      });
      setBlocker(router, (to) => {
        calls.push(`two:${to}`);
        return false;
      });
      setBlocker(router, (to) => {
        calls.push(`three:${to}`);
        return true;
      });

      await navigate(router, '/b');
      calls.should.deepEqual(['one:/b', 'two:/b']);
      history.location.pathname.should.equal('/a');
    });

    it('should veto commit and commitReplace at the chain head', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        resolveView
      );
      setBlocker(router, () => false);

      await commit(
        router,
        Promise.resolve('view:/b'),
        toLocation(router, '/b')
      );
      await commitReplace(
        router,
        Promise.resolve('view:/b'),
        toLocation(router, '/b')
      );
      // The dropped task's failure is swallowed too — without the
      // handler an orphaned rejection would escape as unhandled.
      await commit(
        router,
        Promise.reject(new Error('dropped task failure')),
        toLocation(router, '/b')
      );
      await commitReplace(
        router,
        Promise.reject(new Error('dropped task failure')),
        toLocation(router, '/b')
      );
      history.location.pathname.should.equal('/a');
      router.locationStack.map((l) => l.pathname).should.deepEqual(['/a']);
      resolveView.callCount.should.equal(0);
    });

    it('should never block a refresh', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      let calls = 0;
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}:${++calls}`)
      );
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        resolveView
      );
      await navigate(router, '/b');
      resolveView.callCount.should.equal(1);
      setBlocker(router, () => false);

      await refresh(router);
      // Same location re-resolved: a refresh is not a page leave.
      history.location.pathname.should.equal('/b');
      (history.location.state as HistoryState).index.should.equal(1);
      resolveView.callCount.should.equal(2);
    });

    it('should ask a redirecting chain once, at its head', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {path: '', children: [{path: '/a', redirect: '/b'}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const asks: string[] = [];
      // Veto every target except the one actually navigated to: a second
      // query for the redirect terminal '/b' would eat the navigation.
      setBlocker(router, (to) => {
        asks.push(to);
        return to !== '/b';
      });

      await navigate(router, '/a');
      asks.should.deepEqual(['/a']);
      history.location.pathname.should.equal('/b');
      getCurrentView(router).should.equal('view:/b');
    });

    it('should rewind a vetoed back POP to the current entry', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {
          path: '',
          children: [{path: '/a'}, {path: '/b'}, {path: '/c'}]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      await navigate(router, '/b');
      await navigate(router, '/c');
      views.length = 0;

      const asks: [string, string][] = [];
      setBlocker(router, (to, from) => {
        asks.push([to, from]);
        return false;
      });

      go(router, -2);
      // The rewind(memory history is synchronous) puts the URL, the
      // state index and the rendered view all back on /c.
      history.location.pathname.should.equal('/c');
      (history.location.state as HistoryState).index.should.equal(2);
      asks.should.deepEqual([['/a', '/c']]);
      // The rewind's own landing re-announced the current view exactly
      // once — the blocked target never showed, and no window-sync
      // replace follows: the landed entry already carries the live
      // window.
      views.should.deepEqual(['view:/c']);
    });

    it('should let an allowed POP land normally', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {
          path: '',
          children: [{path: '/a'}, {path: '/b'}, {path: '/c'}]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      await navigate(router, '/b');
      await navigate(router, '/c');
      views.length = 0;
      setBlocker(router, () => true);

      go(router, -1);
      history.location.pathname.should.equal('/b');
      (history.location.state as HistoryState).index.should.equal(1);
      views.at(-1)!.should.equal('view:/b');
    });

    it('should keep an in-flight chain running across a vetoed POP', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      let releaseGuard!: () => void;
      const guardGate = new Promise<void>((done) => {
        releaseGuard = done;
      });
      const observedAborts: boolean[] = [];
      const router = create(
        {
          path: '',
          children: [
            {path: '/a'},
            {path: '/b'},
            {
              path: '/c',
              beforeLoad: async ({signal}) => {
                await guardGate;
                observedAborts.push(signal.aborted);
              }
            }
          ]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      await navigate(router, '/b');
      views.length = 0;

      // The chain to '/c' parks at its guard; while it runs, a POP
      // back to '/a' is vetoed and rewound. The blocker lets only the
      // chain's own target through.
      const navigation = navigate(router, '/c');
      setBlocker(router, (to) => to === '/c');
      go(router, -1);
      // The rewind landed back on '/b' and the chain is still in
      // flight — the landing neither cancelled nor aborted it.
      history.location.pathname.should.equal('/b');
      (router.resolving === undefined).should.be.false();
      views.should.deepEqual(['view:/b']);

      releaseGuard();
      await navigation;
      // The guard never observed an abort and the chain committed.
      observedAborts.should.deepEqual([false]);
      history.location.pathname.should.equal('/c');
      (history.location.state as HistoryState).index.should.equal(2);
      getCurrentView(router).should.equal('view:/c');
      views.should.deepEqual(['view:/b', 'view:/c']);
    });

    it('should count a throwing blocker as a veto, not an escape', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      await navigate(router, '/b');
      views.length = 0;
      setBlocker(router, (to) => {
        if (to === '/a') throw new Error('boom');
        return true;
      });

      // navigate path: the throw vetoes instead of escaping navigate().
      await navigate(router, '/a');
      history.location.pathname.should.equal('/b');

      // POP path: the throw vetoes inside the history listener instead
      // of breaking it, and the POP is rewound like any veto.
      go(router, -1);
      history.location.pathname.should.equal('/b');
      (history.location.state as HistoryState).index.should.equal(1);
      views.should.deepEqual(['view:/b']);
    });

    it('should ask navigate and POP blockers in the same baseUrl form', async () => {
      const history = createMemoryHistory({initialEntries: ['/app/a']});
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
        {baseUrl: '/app'}
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      const asks: [string, string][] = [];
      setBlocker(router, (to, from) => {
        asks.push([to, from]);
        return true;
      });

      await navigate(router, '/b?x=1');
      go(router, -1);
      // Both entry points see the same committed path form, baseUrl
      // included: the navigate `from` equals the POP `to`.
      asks.should.deepEqual([
        ['/app/b?x=1', '/app/a'],
        ['/app/a', '/app/b?x=1']
      ]);
      history.location.pathname.should.equal('/app/a');
    });

    it('should let a user navigation win over a rewind still in flight', async () => {
      // A browser-like history: the veto's rewind `go()` stays pending
      // across the user's next navigation(memory history applies `go`
      // synchronously, so it can never produce this interleaving).
      const history = createAsyncGoHistory({initialEntries: ['/a']});
      const router = create(
        {
          path: '',
          children: [{path: '/a'}, {path: '/b'}, {path: '/c'}, {path: '/d'}]
        },
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      await navigate(router, '/b');
      await navigate(router, '/c');
      // Land on /b with a forward entry(/c) behind it: the next vetoed
      // POP is a real forward traversal, not a clamped no-op.
      go(router, -1);
      await tick();
      views.length = 0;

      // The unsaved-changes shape: everything is vetoed except the
      // deliberate escape to /d.
      const unblock = setBlocker(router, (to) => to === '/d');

      // A vetoed FORWARD POP(to /c): the rewind go(-1) is queued but
      // has not landed yet.
      forward(router);
      await tick();

      // The user pushes /d before the rewind lands. The commit cancels
      // the pending rewind; the late traversal then walks the normal
      // POP path, is vetoed again, and its own rewind brings the
      // session back to the pushed entry.
      await navigate(router, '/d');
      await tick();
      await tick();

      history.location.pathname.should.equal('/d');
      (history.location.state as HistoryState).index.should.equal(3);
      // Every announcement after the push is the pushed view — the
      // rewind never re-announced the stale /c snapshot.
      views.should.deepEqual(['view:/d', 'view:/d']);
      getCurrentView(router).should.equal('view:/d');
      router.viewStack[3].should.equal('view:/d');

      // The session is left coherent: another blocked POP still rewinds
      // home instead of the flag being stuck or the stack drifting.
      views.length = 0;
      unblock();
      const unblockAgain = setBlocker(router, () => false);
      back(router);
      await tick();
      await tick();
      history.location.pathname.should.equal('/d');
      views.should.deepEqual(['view:/d']);
      unblockAgain();
    });

    it('should restore the settled URL after a zero-delta vetoed POP', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      // Two foreign entries sharing one state index: the POP between
      // them reads delta 0, so there is nothing to rewind.
      history.push('/b', {index: 1});
      history.push('/c', {index: 1});
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}, {path: '/c'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      views.length = 0;
      const asks: [string, string][] = [];
      setBlocker(router, (to, from) => {
        asks.push([to, from]);
        return false;
      });

      go(router, -1);
      // The vetoed same-index POP cannot be rewound, so the settled
      // entry is restored with a replace: the URL, the state index and
      // the re-announced view are all back on /c.
      history.location.pathname.should.equal('/c');
      (history.location.state as HistoryState).index.should.equal(1);
      // The restore re-serialized the session window into the entry,
      // so the router still owns it after the veto.
      (
        (history.location.state as HistoryState).locationStack ?? []
      ).length.should.equal(1);
      asks.should.deepEqual([['/b', '/c']]);
      views.should.deepEqual(['view:/c']);
      getCurrentView(router).should.equal('view:/c');
    });
  });

  describe('preload', () => {
    it('should deduplicate concurrent preloads of the same target', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        resolveView
      );

      // Both callers share one in-flight resolution...
      const [e1, e2] = await Promise.all([
        preload(router, '/b'),
        preload(router, '/b')
      ]);
      resolveView.callCount.should.equal(1);
      (e1 === e2).should.be.true();
      (await e1.task).should.equal('view:/b');

      // ...and a later call within the TTL reuses the cached entry.
      (await preload(router, '/b')).task.should.equal(e1.task);
      resolveView.callCount.should.equal(1);
    });

    it('should re-resolve the target after the ttl expires', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        resolveView
      );

      await preload(router, '/b', {ttl: 1});
      resolveView.callCount.should.equal(1);

      await new Promise((done) => {
        setTimeout(done, 5);
      });
      await preload(router, '/b', {ttl: 1});
      resolveView.callCount.should.equal(2);
    });

    it('should evict a rejected resolution so the next call retries', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      let fail = true;
      const beforeLoad = sinon.fake(() => {
        if (fail) throw new Error('guard boom');
        return undefined;
      });
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {
          path: '',
          children: [{path: '/a'}, {path: '/b', beforeLoad}]
        },
        history,
        resolveView
      );

      let error: any;
      try {
        await preload(router, '/b');
      } catch (e) {
        error = e;
      }
      Should(error).be.an.Error();
      error.message.should.equal('guard boom');

      fail = false;
      const entry = await preload(router, '/b');
      beforeLoad.callCount.should.equal(2);
      resolveView.callCount.should.equal(1);
      (await entry.task).should.equal('view:/b');
    });

    it('should invalidate the cached entry once it is committed', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}`)
      );
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        resolveView
      );

      const entry = await preload(router, '/b');
      resolveView.callCount.should.equal(1);

      // The push consumes the entry and evicts its cache slot.
      await commit(router, entry.task, entry.location);
      const pushed = await preload(router, '/b');
      resolveView.callCount.should.equal(2);
      pushed.should.not.equal(entry);

      // A replace commit evicts the slot as well.
      await commitReplace(router, pushed.task, pushed.location);
      await preload(router, '/b');
      resolveView.callCount.should.equal(3);
    });

    it('should prune expired records of other targets on every write', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {path: '', children: [{path: '/a'}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );

      await preload(router, '/a', {ttl: 1});
      await new Promise((done) => {
        setTimeout(done, 5);
      });

      // Writing /b sweeps the dead /a record instead of letting the
      // cache grow unboundedly across distinct prefetched targets.
      await preload(router, '/b');
      const cache = (router as any).preloadCache as Map<string, unknown>;
      cache.size.should.equal(1);
      cache.has('/a').should.be.false();
    });

    it('should evict the pre-redirect key when the terminal target is committed', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {path: '', children: [{path: '/a', redirect: '/b'}, {path: '/b'}]},
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
      );

      // Cached under the pre-redirect key /a, terminal location /b.
      const entry = await preload(router, '/a');
      entry.location.pathname.should.equal('/b');
      const cache = (router as any).preloadCache as Map<string, unknown>;
      cache.size.should.equal(1);

      // Committing the terminal entry also drops the /a record.
      await commit(router, entry.task, entry.location);
      cache.size.should.equal(0);
    });

    it('should hand preload signals that a later navigation never aborts', async () => {
      const signals: AbortSignal[] = [];
      const park = new Promise<undefined>(() => {});
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        {
          path: '',
          children: [
            {path: '/a'},
            {
              path: '/slow',
              beforeLoad({signal}) {
                signals.push(signal);
                return park;
              }
            },
            {path: '/b'}
          ]
        },
        history,
        (matched, {signal}) => {
          signals.push(signal);
          return Promise.resolve(`view:${matched.at(-1)!.path}`);
        }
      );

      // The preload's guards/loaders run under their own never-aborting
      // signal: its entry promise may be shared by several consumers, so
      // aborting it on behalf of one navigation is not sound.
      preload(router, '/slow');
      await navigate(router, '/b');
      signals.forEach((signal) => signal.aborted.should.be.false());

      // The navigation landed on /b; the parked preload stays pending
      // under its live signal, available to a later consumer.
      history.location.pathname.should.equal('/b');
    });

    describe('bounded concurrency', () => {
      const tick = () =>
        new Promise((done) => {
          setTimeout(done);
        });

      it('should abort the oldest in-flight preload FIFO over the bound', async () => {
        const signals = new Map<string, AbortSignal>();
        const targets = ['/p1', '/p2', '/p3', '/p4'];
        const history = createMemoryHistory({initialEntries: ['/a']});
        const router = create(
          {
            path: '',
            children: [
              {path: '/a'},
              ...targets.map((target) => ({
                path: target,
                beforeLoad({signal}: {signal: AbortSignal}) {
                  signals.set(target, signal);
                  return new Promise<undefined>(() => {});
                }
              }))
            ]
          },
          history,
          () => Promise.resolve('view'),
          {preloadConcurrency: 2}
        );

        preload(router, '/p1');
        preload(router, '/p2');
        await tick();
        signals.get('/p1')!.aborted.should.be.false();
        signals.get('/p2')!.aborted.should.be.false();

        // Over the bound: the oldest(/p1) is aborted, the rest live.
        preload(router, '/p3');
        await tick();
        signals.get('/p1')!.aborted.should.be.true();
        signals.get('/p2')!.aborted.should.be.false();
        signals.get('/p3')!.aborted.should.be.false();

        // The next overflow evicts the next oldest(/p2).
        preload(router, '/p4');
        await tick();
        signals.get('/p2')!.aborted.should.be.true();
        signals.get('/p3')!.aborted.should.be.false();
        signals.get('/p4')!.aborted.should.be.false();
      });

      it('should evict the aborted preload from the cache so a later call retries', async () => {
        const calls: string[] = [];
        const history = createMemoryHistory({initialEntries: ['/a']});
        const router = create(
          {
            path: '',
            children: [
              {path: '/a'},
              {path: '/b'},
              {
                path: '/c',
                beforeLoad({signal}: {signal: AbortSignal}) {
                  calls.push('c');
                  return new Promise<void>((_resolve, reject) => {
                    signal.addEventListener('abort', () =>
                      reject(new Error('aborted'))
                    );
                  });
                }
              }
            ]
          },
          history,
          () => Promise.resolve('view'),
          {preloadConcurrency: 1}
        );

        const evicted = preload(router, '/c').then(
          () => 'resolved',
          (e) => `rejected:${(e as Error).message}`
        );
        // Squeezes /c out of the 1-wide window and aborts it.
        preload(router, '/b');
        (await evicted).should.equal('rejected:aborted');
        calls.should.deepEqual(['c']);

        // The evicted slot is gone: the next preload re-runs the guard.
        preload(router, '/c');
        await tick();
        calls.should.deepEqual(['c', 'c']);
      });

      it('should default the bound to four in-flight preloads', async () => {
        const signals = new Map<string, AbortSignal>();
        const history = createMemoryHistory({initialEntries: ['/a']});
        const router = create(
          {
            path: '',
            children: [
              {path: '/a'},
              ...['/p1', '/p2', '/p3', '/p4', '/p5'].map((target) => ({
                path: target,
                beforeLoad({signal}: {signal: AbortSignal}) {
                  signals.set(target, signal);
                  return new Promise<undefined>(() => {});
                }
              }))
            ]
          },
          history,
          () => Promise.resolve('view')
        );

        preload(router, '/p1');
        preload(router, '/p2');
        preload(router, '/p3');
        preload(router, '/p4');
        await tick();
        signals.forEach((signal) => signal.aborted.should.be.false());

        preload(router, '/p5');
        await tick();
        signals.get('/p1')!.aborted.should.be.true();
        ['/p2', '/p3', '/p4', '/p5'].forEach((p) =>
          signals.get(p)!.aborted.should.be.false()
        );
      });

      it('should not produce unhandled rejections when an evicted preload aborts', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        const history = createMemoryHistory({initialEntries: ['/a']});
        const router = create(
          {
            path: '',
            children: [
              {path: '/a'},
              ...['/b', '/c', '/d'].map((target) => ({
                path: target,
                beforeLoad({signal}: {signal: AbortSignal}) {
                  return new Promise<void>((_resolve, reject) => {
                    signal.addEventListener('abort', () =>
                      reject(new Error(`aborted:${target}`))
                    );
                  });
                }
              }))
            ]
          },
          history,
          () => Promise.resolve('view'),
          {preloadConcurrency: 1}
        );

        // The return promises are dropped on purpose: nobody awaits an
        // evicted background prefetch.
        preload(router, '/b');
        preload(router, '/c');
        preload(router, '/d');
        await tick();
        await tick();
        await tick();
        process.off('unhandledRejection', onUnhandled);
        unhandled.should.deepEqual([]);
      });

      it('should never abort a preload a committing navigation consumes', async () => {
        const viewSignals = new Map<string, AbortSignal>();
        let releaseView!: () => void;
        const parkedView = new Promise<string>((done) => {
          releaseView = () => done('view:/slow');
        });
        const history = createMemoryHistory({initialEntries: ['/a']});
        const router = create(
          {
            path: '',
            children: [{path: '/a'}, {path: '/slow'}, {path: '/x'}]
          },
          history,
          (matched, {signal}) => {
            viewSignals.set(matched.at(-1)!.route.path, signal);
            return matched.at(-1)!.route.path === '/slow'
              ? parkedView
              : Promise.resolve('view:x');
          },
          {preloadConcurrency: 1}
        );

        const entry = await preload(router, '/slow');
        // The entry has settled but its view task is still parked, so
        // the flight is in the window; committing consumes it.
        const committed = commit(router, entry.task, entry.location);
        // A new preload over the 1-wide bound must not evict the
        // consumed flight — /slow's signal stays live...
        preload(router, '/x');
        await tick();
        viewSignals.get('/slow')!.aborted.should.be.false();
        // ...and the navigation completes once the view settles.
        releaseView();
        await committed;
        history.location.pathname.should.equal('/slow');
      });
    });
  });

  describe('bounded memory stack', () => {
    const routes = {
      path: '',
      children: [
        {path: '/a'},
        {path: '/b'},
        {path: '/c'},
        {path: '/d'},
        {path: '/e/:id'}
      ]
    };

    it('should evict the oldest entries and keep window-relative accessors correct', async () => {
      const history = createMemoryHistory({initialEntries: ['/a']});
      const router = create(
        routes,
        history,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
        {maxStackDepth: 3}
      );
      // Five entries in the session: /a plus four navigations.
      await navigate(router, '/b');
      await navigate(router, '/c');
      await navigate(router, '/d');
      await navigate(router, '/e/7');

      // The memory window is bounded and matches the serialized one.
      router.locationStack.length.should.equal(3);
      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/c', '/d', '/e/7']);
      (router as any).baseIndex.should.equal(2);
      const state = history.location.state as HistoryState;
      state.index.should.equal(4);
      state.base!.should.equal(2);
      state
        .locationStack!.map((l) => l.pathname)
        .should.deepEqual(['/c', '/d', '/e/7']);

      // Window-relative accessors stay correct after the eviction.
      getCurrentView(router).should.equal('view:/e/7');
      getParams(router)!.should.deepEqual({id: '7'});
    });

    it('should lazily refresh when POPping outside the window without crashing', async () => {
      const tick = () =>
        new Promise((done) => {
          setTimeout(done);
        });
      const history = createMemoryHistory({initialEntries: ['/a']});
      let count = 0;
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view:${matched.at(-1)!.path}:${++count}`)
      );
      const router = create(routes, history, resolveView, {
        maxStackDepth: 3
      });
      const views: string[] = [];
      listen(router, (v) => views.push(v as string));
      await tick();
      await navigate(router, '/b');
      await navigate(router, '/c');
      await navigate(router, '/d');
      await navigate(router, '/e/7');
      resolveView.callCount.should.equal(5);
      // The window covers absolute indices 2..4.
      (router as any).baseIndex.should.equal(2);

      // /b sits at absolute index 1, before the window.
      go(router, -3);
      history.location.pathname.should.equal('/b');
      await tick();
      // The out-of-window slot lazily refreshed and re-rendered.
      resolveView.callCount.should.equal(6);
      views.at(-1)!.should.equal('view:/b:6');
      getCurrentView(router).should.equal('view:/b:6');
      // The window restarted at the landed position.
      router.locationStack.map((l) => l.pathname).should.deepEqual(['/b']);
      (router as any).baseIndex.should.equal(1);
      (history.location.state as HistoryState).index.should.equal(1);
    });

    it('should restore the bounded window and base after a refresh', async () => {
      const history1 = createMemoryHistory({initialEntries: ['/a']});
      const router1 = create(
        routes,
        history1,
        (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
        {maxStackDepth: 3}
      );
      const states: any[] = [];
      await navigate(router1, '/b');
      states.push(history1.location.state);
      await navigate(router1, '/c');
      states.push(history1.location.state);
      await navigate(router1, '/d');
      states.push(history1.location.state);
      await navigate(router1, '/e/7');
      states.push(history1.location.state);

      // Simulate a refresh on the last entry: the landed entry carries
      // its serialized window.
      const history2 = createMemoryHistory({
        initialEntries: [
          '/a',
          {pathname: '/b', state: states[0]},
          {pathname: '/c', state: states[1]},
          {pathname: '/d', state: states[2]},
          {pathname: '/e/7', state: states[3]}
        ]
      });
      let count = 0;
      const resolveView = sinon.fake((matched: any[]) =>
        Promise.resolve(`view2:${matched.at(-1)!.path}:${++count}`)
      );
      const router2 = create(routes, history2, resolveView, {
        maxStackDepth: 3
      });

      // The restored memory window is consistent with its base offset.
      router2.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/c', '/d', '/e/7']);
      (router2 as any).baseIndex.should.equal(2);
      router2.viewStack.length.should.equal(3);

      const views: string[] = [];
      listen(router2, (v) => views.push(v as string));
      await new Promise((done) => {
        setTimeout(done);
      });
      // listen()'s initial lazy refresh of the current entry.
      resolveView.callCount.should.equal(1);
      getCurrentView(router2).should.equal('view2:/e/7:1');
      getParams(router2)!.should.deepEqual({id: '7'});

      // In-window back lands on the warmed-by-refresh slots lazily but
      // without leaving the window.
      go(router2, -1);
      history2.location.pathname.should.equal('/d');
      await new Promise((done) => {
        setTimeout(done);
      });
      resolveView.callCount.should.equal(2);
      views.at(-1)!.should.equal('view2:/d:2');
      (router2 as any).baseIndex.should.equal(2);
      router2.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/c', '/d', '/e/7']);
    });
  });
});

describe('search', () => {
  /** Minimal Standard Schema fixture: coerces `page` into a positive integer. */
  const pageSchema: StandardSchemaV1<unknown, {page: number}> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        const {page} = value as {page?: unknown};
        const parsed = Number(page);
        return Number.isInteger(parsed) && parsed >= 1
          ? {value: {page: parsed}}
          : {
              issues: [{message: 'expected a positive integer', path: ['page']}]
            };
      }
    }
  };

  /** Same validator behind an async `validate`, as valibot async would be. */
  const asyncSchema: StandardSchemaV1<unknown, {page: number}> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) =>
        Promise.resolve(pageSchema['~standard'].validate(value))
    }
  };

  it('should degrade a search string into the plain input object', () => {
    parseSearchInput('?page=2&tag=a&tag=b').should.deepEqual({
      page: '2',
      tag: ['a', 'b']
    });
    parseSearchInput('page=2').should.deepEqual({page: '2'});
    parseSearchInput('').should.deepEqual({});
    parseSearchInput('flag').should.deepEqual({flag: ''});
  });

  it('should parse a valid search with the schema, sync or async', async () => {
    (await parseSearch(pageSchema, '?page=2')).should.deepEqual({page: 2});
    (await parseSearch(asyncSchema, 'page=3')).should.deepEqual({page: 3});
  });

  it('should reject with SearchError carrying the issues', async () => {
    let error: any;
    try {
      await parseSearch(pageSchema, '?page=abc');
    } catch (e) {
      error = e;
    }
    Should(error).be.an.instanceOf(SearchError);
    Should(error).be.an.instanceOf(NativeRouterError);
    error.message.should.equal(
      'Invalid search params "?page=abc": page: expected a positive integer'
    );
    error.search.should.equal('?page=abc');
    error.issues.should.deepEqual([
      {message: 'expected a positive integer', path: ['page']}
    ]);
  });

  it('should format issue paths of every shape', async () => {
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({
          issues: [
            {message: 'invalid filter', path: [{key: 'filter'}, {key: 0}]},
            {message: 'missing param'}, // no path at all
            {message: 'empty path', path: []}
          ]
        })
      }
    };
    let error: any;
    try {
      await parseSearch(schema, '?filter=x');
    } catch (e) {
      error = e;
    }
    error.message.should.equal(
      'Invalid search params "?filter=x": filter.0: invalid filter; ' +
        'missing param; empty path'
    );
  });

  it('should parse synchronously and reject async schemas', () => {
    parseSearchSync(pageSchema, '?page=7').should.deepEqual({page: 7});
    let error: any;
    try {
      parseSearchSync(asyncSchema, '?page=7');
    } catch (e) {
      error = e;
    }
    Should(error).be.an.Error();
    error.message.should.containEql('asynchronously');
  });

  it('should pass route search schemas to the resolveView untouched', async () => {
    const history = createMemoryHistory({initialEntries: ['/']});
    // Typed as `BaseRoute[]` so `route.search` resolves on every level.
    const routes: BaseRoute[] = [
      {path: '', children: [{path: '/list', search: pageSchema}]}
    ];
    const router = create(
      routes,
      history,
      // A framework's resolveView consumes `route.search` itself: parse
      // the location search and resolve the parsed output as the view.
      async (matched, {location}) =>
        parseSearchSync(matched.at(-1)!.route.search!, location.search)
    );
    await navigate(router, '/list?page=4');
    getCurrentView(router).should.deepEqual({page: 4});
  });

  it('should let search validation failures ride the errorHandler channel', async () => {
    const history = createMemoryHistory({initialEntries: ['/']});
    const routes: BaseRoute[] = [
      {path: '', children: [{path: '/list', search: pageSchema}]}
    ];
    const router = create(
      routes,
      history,
      async (matched, {location}) =>
        parseSearchSync(matched.at(-1)!.route.search!, location.search),
      {
        errorHandler: (e) =>
          `fallback:${e instanceof SearchError ? e.issues[0].message : e}`
      }
    );
    await navigate(router, '/list?page=0');
    getCurrentView(router).should.equal('fallback:expected a positive integer');
  });

  it('should hand beforeLoad the parsed schema search, sync or async', async () => {
    const seen: unknown[] = [];
    const history = createMemoryHistory({initialEntries: ['/']});
    const routes: BaseRoute[] = [
      {
        path: '',
        children: [
          {
            path: '/list',
            search: pageSchema,
            beforeLoad: ({search}) => {
              seen.push(search);
            }
          },
          {
            path: '/async',
            search: asyncSchema,
            beforeLoad: ({search}) => {
              seen.push(search);
            }
          }
        ]
      }
    ];
    const router = create(routes, history, (matched) =>
      Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    await navigate(router, '/list?page=3');
    await navigate(router, '/async?page=5');
    // The guard sees the coerced schema output, not the raw strings.
    seen.should.deepEqual([{page: 3}, {page: 5}]);
  });

  it('should hand beforeLoad the degraded input on schema-less routes', async () => {
    const seen: unknown[] = [];
    const history = createMemoryHistory({initialEntries: ['/']});
    const router = create(
      {
        path: '',
        children: [
          {
            path: '/plain',
            beforeLoad: ({search}) => {
              seen.push(search);
            }
          }
        ]
      },
      history,
      (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    await navigate(router, '/plain?page=2&tag=a&tag=b');
    seen.should.deepEqual([{page: '2', tag: ['a', 'b']}]);
  });

  it('should fail a guarded navigation when the search is invalid', async () => {
    const history = createMemoryHistory({initialEntries: ['/']});
    const routes: BaseRoute[] = [
      {
        path: '',
        children: [
          {path: '/list', search: pageSchema, beforeLoad: () => undefined}
        ]
      }
    ];
    const router = create(
      routes,
      history,
      (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
      {
        errorHandler: (e) =>
          `fallback:${e instanceof SearchError ? e.issues[0].message : e}`
      }
    );
    // The parse runs before the guard phase, so the failure rides the
    // same errorHandler channel a data-phase search error would.
    await navigate(router, '/list?page=abc');
    getCurrentView(router).should.equal('fallback:expected a positive integer');
  });
});

describe('writeSchema', () => {
  /**
   * The painless Home fixture shape: `tag` optional, `offset`/`limit`
   * defaulted by the read contract — the case the factory exists for.
   */
  const homeSchema: StandardSchemaV1<
    unknown,
    {
      tag?: string;
      offset: number;
      limit: number;
    }
  > = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        const raw = (value ?? {}) as Record<string, unknown>;
        const int = (v: unknown) => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
        };
        const out: {
          tag?: string;
          offset: number;
          limit: number;
        } = {
          offset: int(raw.offset) ?? 0,
          limit: int(raw.limit) ?? 10
        };
        if (typeof raw.tag === 'string' && raw.tag !== '') out.tag = raw.tag;
        return {value: out};
      }
    }
  };
  const homeWrite = writeSchema(homeSchema, {offset: 0, limit: 10});

  it('should validate through the read contract, then strip defaults', () => {
    const {validate} = homeWrite['~standard'];
    // The string-world input a URL write degrades into: coercion rides
    // the read schema, the defaulted equal values are omitted.
    validate({offset: '0', limit: '10'}).should.deepEqual({value: {}});
    validate({offset: 20, limit: '10'}).should.deepEqual({value: {offset: 20}});
    validate({tag: 'dragons', offset: 0, limit: 10}).should.deepEqual({
      value: {tag: 'dragons'}
    });
    // Optional keys absent from the read output stay absent.
    validate({}).should.deepEqual({value: {}});
  });

  it('should keep non-defaulted required keys in the projection', () => {
    const listSchema: StandardSchemaV1<unknown, {page: number; size: number}> =
      pageSchemaLike();
    const listWrite = writeSchema(listSchema, {size: 10});
    const {validate} = listWrite['~standard'];
    // `page` has no default: required in, required out — only `size`
    // equal to its default is stripped.
    validate({page: 2, size: 10}).should.deepEqual({value: {page: 2}});
    validate({page: 3, size: 25}).should.deepEqual({
      value: {page: 3, size: 25}
    });
    validate({page: 2}).should.deepEqual({value: {page: 2}});
  });

  it('should pass a rejected read result through untouched', () => {
    const strict: StandardSchemaV1<unknown, {page: number}> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({
          issues: [{message: 'expected a positive integer', path: ['page']}]
        })
      }
    };
    const {validate} = writeSchema(strict, {page: 1})['~standard'];
    const result = validate({page: 'abc'}) as {issues: unknown[]};
    Should(Array.isArray(result.issues)).be.true();
    result.issues.should.deepEqual([
      {message: 'expected a positive integer', path: ['page']}
    ]);
  });

  it('should project asynchronously when the read schema is async', async () => {
    const asyncHome: StandardSchemaV1<
      unknown,
      {
        tag?: string;
        offset: number;
        limit: number;
      }
    > = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) =>
          Promise.resolve(homeSchema['~standard'].validate(value))
      }
    };
    const result = await writeSchema(asyncHome, {offset: 0, limit: 10})[
      '~standard'
    ].validate({offset: 40, limit: 10});
    (result as {value: unknown}).should.deepEqual({value: {offset: 40}});
  });

  it('should strip undefined-valued keys like optional absents', () => {
    const {validate} = writeSchema(homeSchema, {limit: 10})['~standard'];
    // `tag: undefined` never serializes into a query and drops out; the
    // read contract coerces `offset` to its internal 0 — no default is
    // declared for it here, so the coerced value stays in the projection.
    validate({tag: undefined, offset: undefined, limit: 10}).should.deepEqual({
      value: {offset: 0}
    });
  });

  /** `{page}`-coercing fixture with an extra defaulted `size`. */
  function pageSchemaLike(): StandardSchemaV1<
    unknown,
    {
      page: number;
      size: number;
    }
  > {
    return {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          const raw = (value ?? {}) as Record<string, unknown>;
          const page = Number(raw.page);
          const size = Number(raw.size);
          return {
            value: {
              page: Number.isInteger(page) && page >= 1 ? page : 1,
              size: Number.isInteger(size) && size >= 1 ? size : 10
            }
          };
        }
      }
    };
  }
});

describe('searchDeps', () => {
  /**
   * A router whose resolveView counts invocations and stamps views with
   * the search they were resolved for — the probe every "zero re-run"
   * assertion below reads.
   */
  function setup(routes: BaseRoute[], initial = '/list?tag=a&q=1') {
    const history = createMemoryHistory({initialEntries: [initial]});
    let count = 0;
    const resolveView = sinon.fake((matched: any[], {location}: any) =>
      Promise.resolve(
        `view:${matched.at(-1)!.path}:${location.search}:${++count}`
      )
    );
    const router = create(routes, history, resolveView);
    return {router, history, resolveView};
  }

  /** Warm the current entry through listen's bootstrap refresh. */
  async function warm<R extends BaseRoute, V = any>(
    router: RouterInstance<R, V>
  ) {
    const views: [any, NavAction][] = [];
    listen(router, (v, action) => views.push([v, action]));
    await new Promise((done) => {
      setTimeout(done);
    });
    return views;
  }

  it('should keep undeclared routes byte-for-byte on today’s behavior: every navigation re-resolves', async () => {
    const {router, resolveView} = setup([
      {path: '', children: [{path: '/list'}]}
    ]);
    await warm(router);
    resolveView.callCount.should.equal(1);

    // Any search change re-resolves…
    await navigate(router, '/list?tag=a&q=2');
    resolveView.callCount.should.equal(2);
    // …and so does an identical location, and a hash-only hop.
    await navigate(router, '/list?tag=a&q=2');
    resolveView.callCount.should.equal(3);
    await navigate(router, '/list?tag=a&q=2#anchor');
    resolveView.callCount.should.equal(4);
  });

  it('should re-serve the snapshot when declared keys are unchanged', async () => {
    const {router, history, resolveView} = setup([
      {
        path: '',
        searchDeps: [],
        children: [{path: '/list', searchDeps: ['tag']}]
      }
    ]);
    const views = await warm(router);
    resolveView.callCount.should.equal(1);

    await navigate(router, '/list?tag=a&q=2');
    // Zero re-resolves: the current snapshot was re-served…
    resolveView.callCount.should.equal(1);
    // …the history still moved(push semantics preserved)…
    history.location.search.should.equal('?tag=a&q=2');
    (history.location.state as HistoryState).index.should.equal(1);
    // …both stack slots hold the very same view object…
    router.viewStack[0].should.equal(router.viewStack[1]);
    // …and listen announced the reused view with the push action.
    views.at(-1)![0].should.equal('view:/list:?tag=a&q=1:1');
    views.at(-1)![1].should.equal('push');
  });

  it('should re-resolve when a declared key changes', async () => {
    const {router, resolveView} = setup([
      {
        path: '',
        searchDeps: [],
        children: [{path: '/list', searchDeps: ['tag']}]
      }
    ]);
    await warm(router);
    await navigate(router, '/list?tag=b&q=1');
    resolveView.callCount.should.equal(2);
    getCurrentView(router).should.equal('view:/list:?tag=b&q=1:2');
  });

  it('should treat an empty deps array as total search-irrelevance', async () => {
    const {router, resolveView} = setup([
      {path: '', searchDeps: [], children: [{path: '/list', searchDeps: []}]}
    ]);
    await warm(router);
    await navigate(router, '/list?anything=else&tag=z');
    await navigate(router, '/list');
    resolveView.callCount.should.equal(1);
  });

  it('should support the function form, compared via JSON serialization', async () => {
    const {router, resolveView} = setup(
      [
        {
          path: '',
          searchDeps: [],
          children: [
            {
              path: '/list',
              // Derived projection: only the tag/offset pair matters.
              searchDeps: (search) => [search.tag, Number(search.offset ?? 0)]
            }
          ]
        }
      ],
      '/list?tag=a&offset=1&q=1'
    );
    await warm(router);
    // Irrelevant keys reuse…
    await navigate(router, '/list?tag=a&offset=1&q=2');
    resolveView.callCount.should.equal(1);
    // Coercible-equal values produce the same projection: '01' → 1.
    await navigate(router, '/list?tag=a&offset=01&q=3');
    resolveView.callCount.should.equal(1);
    // A changed projection member re-resolves.
    await navigate(router, '/list?tag=a&offset=2&q=3');
    resolveView.callCount.should.equal(2);
    await navigate(router, '/list?tag=b&offset=2&q=3');
    resolveView.callCount.should.equal(3);
  });

  it('should require every level of the chain to declare', async () => {
    const undeclaredChild = setup([
      {path: '', searchDeps: [], children: [{path: '/list'}]}
    ]);
    await warm(undeclaredChild.router);
    await navigate(undeclaredChild.router, '/list?tag=a&q=2');
    undeclaredChild.resolveView.callCount.should.equal(2);

    const undeclaredParent = setup([
      {path: '', children: [{path: '/list', searchDeps: []}]}
    ]);
    await warm(undeclaredParent.router);
    await navigate(undeclaredParent.router, '/list?tag=a&q=2');
    undeclaredParent.resolveView.callCount.should.equal(2);

    const fullyDeclared = setup([
      {
        path: '',
        searchDeps: [],
        children: [{path: '/list', searchDeps: ['tag']}]
      }
    ]);
    await warm(fullyDeclared.router);
    await navigate(fullyDeclared.router, '/list?tag=a&q=2');
    fullyDeclared.resolveView.callCount.should.equal(1);
  });

  it('should re-resolve the chain when a parent’s declared key changes, child’s unchanged', async () => {
    const {router, resolveView} = setup([
      {
        path: '',
        searchDeps: ['layout'],
        children: [{path: '/list', searchDeps: ['tag']}]
      }
    ]);
    await warm(router);
    await navigate(router, '/list?tag=a&layout=x');
    resolveView.callCount.should.equal(2);
  });

  it('should reuse on hash-only navigations of fully declared chains', async () => {
    const {router, history, resolveView} = setup([
      {path: '', searchDeps: [], children: [{path: '/list', searchDeps: []}]}
    ]);
    await warm(router);
    await navigate(router, '/list?tag=a&q=1#section');
    resolveView.callCount.should.equal(1);
    history.location.hash.should.equal('#section');
  });

  it('should re-resolve a different pathname even when deps look equal', async () => {
    const {router, resolveView} = setup(
      [
        {
          path: '',
          searchDeps: [],
          children: [
            {path: '/list', searchDeps: []},
            {path: '/other', searchDeps: []}
          ]
        }
      ],
      '/list?tag=a'
    );
    await warm(router);
    await navigate(router, '/other?tag=a');
    resolveView.callCount.should.equal(2);
    getCurrentView(router).should.equal('view:/other:?tag=a:2');
  });

  it('should replay snapshots on POP after reuse navigations, zero re-resolves', async () => {
    const {router, history, resolveView} = setup([
      {
        path: '',
        searchDeps: [],
        children: [{path: '/list', searchDeps: ['tag']}]
      }
    ]);
    const views = await warm(router);
    await navigate(router, '/list?tag=a&q=2');
    await navigate(router, '/list?tag=b&q=2');

    const baseline = resolveView.callCount;
    // Back two: first the reused slot, then the warm-up slot.
    go(router, -2);
    history.location.search.should.equal('?tag=a&q=1');
    views.at(-1)![0].should.equal('view:/list:?tag=a&q=1:1');
    go(router, 1);
    history.location.search.should.equal('?tag=a&q=2');
    // The reused slot replays the SAME snapshot object.
    views.at(-1)![0].should.equal('view:/list:?tag=a&q=1:1');
    go(router, 1);
    views.at(-1)![0].should.equal('view:/list:?tag=b&q=2:2');
    resolveView.callCount.should.equal(baseline);
  });

  it('should disable the fast path after invalidate() until the next resolve', async () => {
    const guards: string[] = [];
    const history = createMemoryHistory({initialEntries: ['/list?tag=a']});
    let count = 0;
    const router = create(
      {
        path: '',
        searchDeps: [],
        children: [
          {
            path: '/list',
            searchDeps: ['tag'],
            beforeLoad: () => {
              guards.push('ran');
            }
          }
        ]
      },
      history,
      () => Promise.resolve(`view:${++count}`)
    );
    await warm(router);
    guards.should.deepEqual(['ran']);

    invalidate(router);
    // No snapshot left: the deps-equal navigation re-resolves…guards included.
    await navigate(router, '/list?tag=a&q=2');
    guards.should.deepEqual(['ran', 'ran']);
    count.should.equal(2);
    // …and once a snapshot exists again, the fast path is back.
    await navigate(router, '/list?tag=a&q=3');
    count.should.equal(2);
  });

  it('should skip guards on the fast path but hand them the fresh search when they run', async () => {
    const seen: unknown[] = [];
    const history = createMemoryHistory({initialEntries: ['/list?tag=a']});
    const router = create(
      {
        path: '',
        searchDeps: [],
        children: [
          {
            path: '/list',
            searchDeps: ['tag'],
            beforeLoad: ({search}) => {
              seen.push(search);
            }
          }
        ]
      },
      history,
      (matched: any[]) => Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    await warm(router);
    // Fast path: the guard does not re-run for an irrelevant key…
    await navigate(router, '/list?tag=a&q=2');
    seen.should.have.length(1);
    // …but a declared-key change re-runs it against the NEW search.
    await navigate(router, '/list?tag=z&q=2');
    seen.should.deepEqual([{tag: 'a'}, {tag: 'z', q: '2'}]);
  });

  it('should keep guard redirect chains working from a declared route', async () => {
    const {router, history, resolveView} = setup(
      [
        {
          path: '',
          children: [
            {path: '/list', searchDeps: []},
            {path: '/guarded', beforeLoad: () => '/login'},
            {path: '/login'}
          ]
        }
      ],
      '/list'
    );
    await warm(router);
    await navigate(router, '/guarded?x=1');
    // The redirect resolved the terminal target, not a reuse.
    history.location.pathname.should.equal('/login');
    resolveView.callCount.should.equal(2);
  });

  it('should abort a superseded in-flight chain when the fast path commits', async () => {
    const park = new Promise<undefined>(() => {});
    const history = createMemoryHistory({initialEntries: ['/list?tag=a']});
    const signals: AbortSignal[] = [];
    const router = create(
      {
        path: '',
        searchDeps: [],
        children: [{path: '/list', searchDeps: ['tag']}, {path: '/slow'}]
      },
      history,
      (matched: any[], {signal}: any) => {
        signals.push(signal);
        if (matched.at(-1)!.path === '/slow') return park;
        return Promise.resolve(`view:${matched.at(-1)!.path}`);
      }
    );
    await warm(router);
    // A slow chain to another route…
    navigate(router, '/slow').catch(() => undefined);
    // …superseded by a fast-path navigation on the current route.
    await navigate(router, '/list?tag=a&q=2');
    signals[1]!.aborted.should.be.true();
    history.location.search.should.equal('?tag=a&q=2');
    (router.resolving === undefined).should.be.true();
  });

  it('should consult blockers before the fast path', async () => {
    const {router, history, resolveView} = setup([
      {path: '', searchDeps: [], children: [{path: '/list', searchDeps: []}]}
    ]);
    await warm(router);
    const unblock = setBlocker(router, () => false);
    await navigate(router, '/list?tag=a&q=2');
    // Vetoed: no history change, no reuse commit.
    history.location.search.should.equal('?tag=a&q=1');
    resolveView.callCount.should.equal(1);
    unblock();
    await navigate(router, '/list?tag=a&q=2');
    resolveView.callCount.should.equal(1);
    history.location.search.should.equal('?tag=a&q=2');
  });

  it('should answer reusableEntry directly', async () => {
    const {router} = setup([
      {
        path: '',
        searchDeps: [],
        children: [{path: '/list', searchDeps: ['tag']}, {path: '/other'}]
      }
    ]);
    await warm(router);
    // Same route, unchanged declared key: the current view is reusable.
    const entry = reusableEntry(router, toLocation(router, '/list?tag=a&q=9'));
    (await entry!.task).should.equal('view:/list:?tag=a&q=1:1');
    // A declared key change, a different pathname and unknown paths: no.
    (
      reusableEntry(router, toLocation(router, '/list?tag=b')) === undefined
    ).should.be.true();
    (
      reusableEntry(router, toLocation(router, '/other?tag=a')) === undefined
    ).should.be.true();
    (
      reusableEntry(router, toLocation(router, '/missing?tag=a')) === undefined
    ).should.be.true();
    // Fresh router without a snapshot: no.
    const bareHistory = createMemoryHistory({initialEntries: ['/list?tag=a']});
    const bare = create(
      {path: '', searchDeps: [], children: [{path: '/list', searchDeps: []}]},
      bareHistory,
      (matched: any[]) => Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    (
      reusableEntry(bare, toLocation(bare, '/list?tag=a&q=2')) === undefined
    ).should.be.true();
  });
});

describe('params', () => {
  /** Minimal Standard Schema fixture: coerces `id` into a positive integer. */
  const idSchema: StandardSchemaV1<unknown, {id: number}> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        const {id} = value as {id?: unknown};
        const parsed = Number(id);
        return Number.isInteger(parsed) && parsed >= 1
          ? {value: {id: parsed}}
          : {
              issues: [{message: 'expected a positive integer', path: ['id']}]
            };
      }
    }
  };

  /**
   * Fixture validating the whole merged map (`userId` + `postId`) the way
   * a real zod object schema would — every key coerced in one pass.
   */
  const mergedSchema: StandardSchemaV1<
    unknown,
    {userId: number; postId: number}
  > = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        const {userId, postId} = value as Record<string, unknown>;
        const u = Number(userId);
        const p = Number(postId);
        return Number.isInteger(u) && u >= 1 && Number.isInteger(p) && p >= 1
          ? {value: {userId: u, postId: p}}
          : {issues: [{message: 'expected positive integers'}]};
      }
    }
  };

  /** Same validator behind an async `validate`, as valibot async would be. */
  const asyncIdSchema: StandardSchemaV1<unknown, {id: number}> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) =>
        Promise.resolve(idSchema['~standard'].validate(value))
    }
  };

  it('should parse valid params with the schema, sync or async', async () => {
    (await parseParams(idSchema, {id: '7'})).should.deepEqual({id: 7});
    (await parseParams(asyncIdSchema, {id: '9'})).should.deepEqual({id: 9});
  });

  it('should reject with ParamsError carrying the issues', async () => {
    let error: any;
    try {
      await parseParams(idSchema, {id: 'abc'});
    } catch (e) {
      error = e;
    }
    Should(error).be.an.instanceOf(ParamsError);
    Should(error).be.an.instanceOf(NativeRouterError);
    error.message.should.equal(
      'Invalid path params "{"id":"abc"}": id: expected a positive integer'
    );
    error.params.should.deepEqual({id: 'abc'});
    error.issues.should.deepEqual([
      {message: 'expected a positive integer', path: ['id']}
    ]);
  });

  it('should parse synchronously and reject async schemas', () => {
    parseParamsSync(idSchema, {id: '7'}).should.deepEqual({id: 7});
    let error: any;
    try {
      parseParamsSync(asyncIdSchema, {id: '7'});
    } catch (e) {
      error = e;
    }
    error.message.should.equal(
      'The params schema validates asynchronously; parse it during resolve ' +
        '(parseParams) instead of synchronously'
    );
  });

  /** Same fixture keyed on `userId`, for parent-level prefix validation. */
  const userIdSchema: StandardSchemaV1<unknown, {userId: number}> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        const {userId} = value as {userId?: unknown};
        const parsed = Number(userId);
        return Number.isInteger(parsed) && parsed >= 1
          ? {value: {userId: parsed}}
          : {
              issues: [
                {message: 'expected a positive integer', path: ['userId']}
              ]
            };
      }
    }
  };

  it('should hand beforeLoad the coerced params of the merged prefix', async () => {
    const seen: unknown[] = [];
    const history = createMemoryHistory({initialEntries: ['/']});
    const routes: BaseRoute[] = [
      {
        path: '/users/:userId',
        params: userIdSchema,
        children: [
          {
            path: '/posts/:postId',
            beforeLoad: ({params}) => {
              seen.push(params);
            }
          }
        ]
      }
    ];
    const router = create(routes, history, (matched) =>
      Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    // The parent level's schema coerces `userId` at its turn; the guard
    // of the schema-less child sees it merged with the child's raw
    // `postId`.
    await navigate(router, '/users/1/posts/2');
    seen.should.deepEqual([{userId: 1, postId: '2'}]);
  });

  it('should let a deeper schema coerce the whole merged prefix', async () => {
    const seen: unknown[] = [];
    const history = createMemoryHistory({initialEntries: ['/']});
    const routes: BaseRoute[] = [
      {
        path: '/users/:userId',
        params: userIdSchema,
        children: [
          {
            path: '/posts/:postId',
            params: mergedSchema,
            beforeLoad: ({params}) => {
              seen.push(params);
            }
          }
        ]
      }
    ];
    const router = create(routes, history, (matched) =>
      Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    // The child's schema validates the whole merged map, so by the guard
    // phase every param is a number — including the parent's `userId`.
    await navigate(router, '/users/1/posts/2');
    seen.should.deepEqual([{userId: 1, postId: 2}]);
  });

  it('should keep raw string params on schema-less routes', async () => {
    const seen: unknown[] = [];
    const history = createMemoryHistory({initialEntries: ['/']});
    const router = create(
      {
        path: '',
        children: [
          {
            path: '/users/:id',
            beforeLoad: ({params}) => {
              seen.push(params);
            }
          }
        ]
      },
      history,
      (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    await navigate(router, '/users/7');
    seen.should.deepEqual([{id: '7'}]);
  });

  it('should fail a guarded navigation when params are invalid', async () => {
    const history = createMemoryHistory({initialEntries: ['/']});
    const routes: BaseRoute[] = [
      {
        path: '',
        children: [
          {path: '/users/:id', params: idSchema, beforeLoad: () => undefined}
        ]
      }
    ];
    const router = create(
      routes,
      history,
      (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`),
      {
        errorHandler: (e) =>
          `fallback:${e instanceof ParamsError ? e.issues[0].message : e}`
      }
    );
    // The params parse runs before the guard phase, so the failure rides
    // the same errorHandler channel a search-schema failure would; the
    // view falls back but the history entry still commits.
    await navigate(router, '/users/abc');
    getCurrentView(router).should.equal('fallback:expected a positive integer');
    history.location.pathname.should.equal('/users/abc');
  });

  it('should skip a failing params schema on a redirect level', async () => {
    const history = createMemoryHistory({initialEntries: ['/']});
    const routes: BaseRoute[] = [
      {
        path: '',
        children: [
          // The redirect level never runs its guard, so its schema must
          // not run either — matching the search schema's redirect
          // asymmetry. Navigating with unparseable params redirects
          // instead of failing through the errorHandler channel.
          {path: '/users/:id', params: idSchema, redirect: '/users'},
          {path: '/users'}
        ]
      }
    ];
    const router = create(routes, history, (matched) =>
      Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    await navigate(router, '/users/abc');
    history.location.pathname.should.equal('/users');
    getCurrentView(router).should.equal('view:/users');
  });

  it('should let a child same-name segment overwrite the parent coerced value', async () => {
    // `/users/:id/files/:id`: the parent schema coerces its `id`, then
    // the child segment's RAW string overwrites it in the merge — the
    // documented deep-over-shallow semantics operate on raw params, so
    // coercion must be declared on (or below) the deepest level that
    // reads the param.
    const seen: unknown[] = [];
    const history = createMemoryHistory({initialEntries: ['/']});
    const routes: BaseRoute[] = [
      {
        path: '/users/:id',
        params: idSchema,
        children: [
          {
            path: '/files/:id',
            beforeLoad: ({params}) => {
              seen.push(params);
            }
          }
        ]
      }
    ];
    const router = create(routes, history, (matched) =>
      Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    await navigate(router, '/users/1/files/9');
    seen.should.deepEqual([{id: '9'}]);
  });

  it('should validate a wildcard param through the merged string map', async () => {
    // The matcher hands wildcards over as `string[]` (path-to-regexp 8.4.2);
    // the schema is the place to normalize them.
    const restSchema: StandardSchemaV1<unknown, {rest: number[]}> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          const {rest} = value as {rest?: unknown};
          const nums = Array.isArray(rest) ? rest.map(Number) : [];
          return Array.isArray(rest) &&
            nums.every((n) => Number.isInteger(n) && n >= 0)
            ? {value: {rest: nums}}
            : {
                issues: [{message: 'expected integer segments', path: ['rest']}]
              };
        }
      }
    };
    const seen: unknown[] = [];
    const history = createMemoryHistory({initialEntries: ['/']});
    const router = create(
      {
        path: '',
        children: [
          {
            path: '/files/*rest',
            params: restSchema,
            beforeLoad: ({params}) => {
              seen.push(params);
            }
          }
        ]
      } as BaseRoute,
      history,
      (matched) => Promise.resolve(`view:${matched.at(-1)!.path}`)
    );
    await navigate(router, '/files/1/2/3');
    seen.should.deepEqual([{rest: [1, 2, 3]}]);
  });
});
