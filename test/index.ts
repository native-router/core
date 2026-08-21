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
  mergeMatchedParams
} from '../src/router';
import type {HistoryState} from '../src/types';

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
    it('should cancel the current navigate', () => {
      // Test code here
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
      // The refresh replaced in place, the index did not change.
      router.viewStack.length.should.equal(3);
      router.viewStack[1]!.should.equal('view:/bar:2');
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
        // The in-memory stack still holds the whole session.
        router.locationStack
          .map((l) => l.pathname)
          .should.deepEqual(['/a', '/b', '/c', '/d', '/e']);

        // A replace keeps the window capped as well.
        await refresh(router);
        const replaced = history.location.state as HistoryState;
        replaced.locationStack!.length.should.equal(3);
        replaced.base!.should.equal(2);
      });

      it('should restore a windowed stack with placeholders and lazily refresh evicted slots', async () => {
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
        // Slot 0 is a placeholder for the evicted entry.
        router2.locationStack.length.should.equal(3);
        (router2.locationStack[0] === undefined).should.be.true();
        router2.locationStack
          .slice(1)
          .map((l) => l.pathname)
          .should.deepEqual(['/b', '/c']);

        const views: string[] = [];
        listen(router2, (v) => views.push(v as string));
        await tick();
        // listen()'s initial lazy refresh of the current entry.
        count.should.equal(1);

        await initHistoryStack(router2);
        // The placeholder slot stays unresolved.
        count.should.equal(3);
        (router2.viewStack[0] === null).should.be.true();
        router2.viewStack[1]!.should.equal('view2:/b:2');

        // In-window back is warmed: zero new resolves.
        go(router2, -1);
        history2.location.pathname.should.equal('/b');
        await tick();
        count.should.equal(3);
        views.at(-1)!.should.equal('view2:/b:2');

        // Back onto the placeholder lazily refreshes the entry.
        go(router2, -1);
        history2.location.pathname.should.equal('/a');
        await tick();
        count.should.equal(4);
        views.at(-1)!.should.equal('view2:/a:4');
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
        // the memory stack only holds the current entry, the view stack
        // stays aligned with the absolute index.
        router.locationStack.map((l) => l.pathname).should.deepEqual(['/baz']);
        router.viewStack.length.should.equal(3);
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
  });
});
