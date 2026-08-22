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
  initHistoryStack,
  getCurrentView,
  getParams,
  preload,
  mergeMatchedParams
} from '../src/router';
import type {HistoryState} from '../src/types';
import {
  NativeRouterError,
  NotFoundError,
  RedirectLoopError
} from '../src/errors';

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
    it('should navigate in history stack', () => {
      // Test code here
    });
  });

  describe('forward', () => {
    it('should forward in history stack', () => {
      // Test code here
    });
  });

  describe('back', () => {
    it('should go back in history stack', () => {
      // Test code here
    });
  });

  describe('createHref', () => {
    it('should create href of a route path', () => {
      // Test code here
    });
  });

  describe('cancel', () => {
    const tick = () =>
      new Promise((done) => {
        setTimeout(done);
      });

    it('should cancel the current navigate', () => {
      // Test code here
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
        getParams(router).should.deepEqual({id: '123', postId: '456'});
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
      getParams(router).should.deepEqual({id: '123'});
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
      getParams(router).should.deepEqual({id: '99'});
    });

    it('should return an empty object when the current entry is outside the restored window', () => {
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
      // so its slot is out-of-window and reads as empty.
      router.locationStack
        .map((l) => l.pathname)
        .should.deepEqual(['/a', '/b']);
      (router as any).baseIndex.should.equal(2);
      getParams(router).should.deepEqual({});
    });

    it('should return an empty object when the current path matches no route', () => {
      const history = createMemoryHistory({initialEntries: ['/unknown']});
      const router = create(
        {path: '', children: [{path: '/users/:id'}]},
        history,
        () => Promise.resolve(null)
      );
      getParams(router).should.deepEqual({});
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
      getParams(router).should.deepEqual({id: '7'});
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
      getParams(router2).should.deepEqual({id: '7'});

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
