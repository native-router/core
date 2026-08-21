import {createPath, History, parsePath} from 'history';
import {match as createMatcher} from 'path-to-regexp';
import type {
  Location,
  Matched,
  Options,
  BaseRoute,
  RouterInstance,
  ResolveView,
  HistoryState
} from './types';
import {createCurrentGuard, noop, reject} from './util';
import {NotFoundError} from './errors';

const DEFAULT_MAX_STACK_DEPTH = 100;

/**
 * Create a router instance.
 * @group Methods
 * @category Router
 * @param routes routes config
 * @param history {@link https://www.npmjs.com/package/history history} instance
 * @param resolveView a callback to resolve view. see {@link defaultResolveView}
 * @param options options
 * @returns a router instance
 */
export function create<R extends BaseRoute = BaseRoute, V = any>(
  routes: R | R[],
  history: History,
  resolveView: ResolveView<R, V>,
  options?: Options<V>
): RouterInstance<R, V> {
  type InstanceHistory = RouterInstance<any>['history'];

  const [currentGuard, cancelAll] = createCurrentGuard();
  const {index} = getHistoryState({
    history: history as InstanceHistory
  });
  // Restore the session stack from the bounded window serialized in the
  // current entry state; entries before the window become placeholders.
  // Legacy index-only state(1.x) degrades to a single-entry stack.
  const locationStack = restoreLocationStack(history as InstanceHistory);
  const viewStack = new Array(Math.max(index + 1, locationStack.length)).fill(
    null
  );

  if (options?.currentView) {
    viewStack[index] = options.currentView;
  }

  return {
    routes: Array.isArray(routes) ? routes : [routes],
    resolveView,

    history: history as InstanceHistory,
    locationStack,
    viewStack,
    currentGuard,
    cancelAll,

    errorHandler: reject,
    ...options,
    baseUrl: options?.baseUrl || '',
    maxStackDepth: options?.maxStackDepth || DEFAULT_MAX_STACK_DEPTH
  };
}

export function setOptions<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  options: Omit<Options<V>, 'currentView'>
) {
  return Object.assign(router, options);
}

export function getLocation({history}: Pick<RouterInstance<any>, 'history'>) {
  const state = (history.location.state || {}) as Partial<HistoryState>;
  return {...history.location, state: state.state};
}

/**
 * Restore the in-memory location stack from the bounded window in the
 * current history entry state. Slots before the window become
 * placeholders(`undefined`) so {@link initHistoryStack} can skip them
 * and a POP onto them still falls back to a lazy refresh.
 */
function restoreLocationStack(
  history: RouterInstance<any>['history']
): Location[] {
  const state = (history.location.state || {}) as Partial<HistoryState>;
  const {locationStack, base} = state;
  return locationStack?.length
    ? [...new Array<Location>(base || 0), ...locationStack]
    : [getLocation({history})];
}

/**
 * Serialize the tail window of the in-memory stack, bounded by
 * `maxStackDepth`, together with the absolute index of its first entry.
 */
function serializeStack(router: RouterInstance<any>): {
  base: number;
  locationStack: Location[];
} {
  const {locationStack, maxStackDepth} = router;
  const windowed = locationStack.slice(-maxStackDepth);
  return {
    base: locationStack.length - windowed.length,
    locationStack: windowed
  };
}

function getHistoryState(router: Pick<RouterInstance<any>, 'history'>) {
  const state = (router.history.location.state || {}) as Partial<HistoryState>;
  return {
    index: state.index || 0
  };
}

export function getCurrentView<R extends BaseRoute = BaseRoute>(
  router: RouterInstance<R>
) {
  return router.viewStack[getHistoryState(router).index];
}

/**
 * Match a path.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param pathname the pathname
 * @returns the matched result
 */
export function match<R extends BaseRoute = BaseRoute>(
  router: RouterInstance<R>,
  pathname: string
) {
  function matchRoutes(
    routes: R[],
    baseUrl: string,
    // eslint-disable-next-line @typescript-eslint/no-shadow
    pathname: string
  ): Matched<R>[] | undefined {
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const end = !route.children;
      const matched = route.path
        ? createMatcher<Record<string, string>>(route.path, {
            strict: true,
            sensitive: true,
            decode:
              typeof decodeURIComponent === 'function'
                ? decodeURIComponent
                : undefined,
            end
          })(pathname)
        : {
            path: '',
            index: 0,
            params: {}
          };

      if (matched) {
        const result = {route, ...matched};
        if (end) return [result];
        const children = matchRoutes(
          route.children!,
          `${baseUrl}${route.path || ''}`,
          pathname.slice(matched.path.length)
        );
        if (children) return [result, ...children];
        return undefined;
      }
    }
    return undefined;
  }

  return matchRoutes(
    router.routes,
    router.baseUrl,
    pathname.slice(router.baseUrl.length)
  );
}

/**
 * Path to Location.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param to path string
 * @param state the state of location
 * @returns location
 */
export function toLocation<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  to: string,
  state?: any
): Location {
  const {baseUrl} = router;
  return {
    pathname: '',
    search: '',
    hash: '',
    ...parsePath(baseUrl + to),
    state
  };
}

/**
 * Resolve a location.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param location history instance
 * @returns resolve task(a promise)
 */
export function resolve<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  location: Location
) {
  const matched = match<R>(router, location.pathname);
  const {resolveView, errorHandler} = router;
  return (
    matched
      ? resolveView(matched, {router, location})
      : Promise.reject(new NotFoundError(location.pathname))
  ).catch(errorHandler);
}

/**
 * Resolve a path.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param to the path
 * @param state state of the path location
 * @returns resolve task(a promise)
 */
export function resolveTo<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  to: string,
  state?: any
) {
  const location = toLocation(router, to, state);
  return resolve(router, location);
}

/**
 * Commit the resolve task and push history.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param resolvePromise resolve task(a promise)
 * @param location the location to resolved
 */
export function commit<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  resolvePromise: Promise<V>,
  location: Location
): Promise<void> {
  const {history} = router;
  const nextIndex = getHistoryState(router).index + 1;
  return commitBase(router, resolvePromise, location, (resolvedView) => {
    router.locationStack = [
      ...router.locationStack.slice(0, nextIndex),
      location
    ];
    router.viewStack = [...router.viewStack.slice(0, nextIndex), resolvedView];
    history.push(location, {
      index: nextIndex,
      state: location.state,
      ...serializeStack(router)
    });
  });
}

/**
 * Commit the resolve task and replace history.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param resolvePromise resolve task(a promise)
 * @param location the location to resolved
 */
export function commitReplace<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  resolvePromise: Promise<V>,
  location: Location
): Promise<void> {
  const {history} = router;
  const {index} = getHistoryState(router);
  return commitBase(router, resolvePromise, location, (resolvedView) => {
    router.locationStack[index] = location;
    router.viewStack[index] = resolvedView;
    history.replace(location, {
      index,
      state: location.state,
      ...serializeStack(router)
    });
  });
}

function commitBase<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  resolvePromise: Promise<V>,
  location: Location,
  onResolved: (resolvedView: V) => void
): Promise<void> {
  const {currentGuard, onLoadingChange = noop} = router;
  if (router.resolving) {
    // Cancel current resolve
    onLoadingChange();
  }
  router.resolving = location;
  onLoadingChange('pending');
  return (
    currentGuard(resolvePromise)
      .then(onResolved)
      // eslint-disable-next-line no-void
      .then(() => void onLoadingChange('resolved'))
      .catch((e) => {
        onLoadingChange('rejected');
        throw e;
      })
  );
}

/**
 * Navigate to a new path.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param to path string
 * @param state location state
 */
export function navigate<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  to: string,
  state?: any
): Promise<void> {
  const location = toLocation(router, to, state);
  const viewPromise = resolve(router, location);
  return commit(router, viewPromise, location);
}

/**
 * Refresh the page.
 * @group Methods
 * @category Router
 * @param router router instance
 */
export function refresh<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>
) {
  const location = getLocation(router);
  const viewPromise = resolve(router, location);
  return commitReplace(router, viewPromise, location);
}

/**
 * Navigate in history stack.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param delta history stack index
 */
export function go<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  delta: number
) {
  router.history.go(delta);
}

/**
 * Forward in history stack.
 * @group Methods
 * @category Router
 * @param router router instance
 */
export function forward<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>
) {
  router.history.forward();
}

/**
 * Back in history stack.
 * @group Methods
 * @category Router
 * @param router router instance
 */
export function back<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>
) {
  router.history.back();
}

/**
 * Create href of a route path. For {@link Link Link Component} hover url preview.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param to route path
 * @returns href
 */
export function createHref<R extends BaseRoute = BaseRoute, V = any>(
  {baseUrl, history}: RouterInstance<R, V>,
  to: string
) {
  return baseUrl + history.createHref(to);
}

/**
 * Cancel the current navigate.
 * @group Methods
 * @category Router
 * @param router router instance
 */
export function cancel<R extends BaseRoute = BaseRoute, V = any>({
  cancelAll,
  onLoadingChange = noop
}: RouterInstance<R, V>) {
  cancelAll();
  onLoadingChange();
}

/**
 * Restore/warm up the view stack by re-resolving every reachable entry
 * of the in-memory location stack. Call it after a refresh: in-window
 * back/forward then switch views without new resolves.
 *
 * 恢复/预热内存栈中的可达条目（窗口内有 location 的槽位），刷新后调用
 * 可让窗口内前进/后退零请求。
 * @group Methods
 * @category Router
 * @param router router instance
 */
export function initHistoryStack<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>
) {
  return Promise.all(
    router.locationStack.map((location) =>
      location ? resolve(router, location) : Promise.resolve(null)
    ) as Promise<V>[]
  ).then((views) => {
    router.viewStack = views;
  });
}

/**
 * Listen the history change.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param onViewChange a callback function will be call when view changed
 * @returns unlisten - A function that may be used to stop listening
 */
export function listen<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  onViewChange: (v: V) => void
) {
  const {history} = router;

  const rmListener = history.listen(({action, location}) => {
    cancel(router);

    const state = location.state as HistoryState | undefined;
    const index = state?.index || 0;
    const view = router.viewStack[index];

    onViewChange(view);
    if (!view) {
      // Lazy fallback for placeholder slots and legacy-shaped state:
      // re-resolving the landed entry also re-serializes the window
      // into it via the replace commit.
      refresh(router);
    } else if (action === 'POP') {
      // Sync the current window into the landed entry so a later
      // refresh("refresh → back → refresh again") still restores it.
      history.replace(createPath(history.location), {
        ...state,
        index,
        ...serializeStack(router)
      });
    }
  });

  history.replace(createPath(history.location), history.location.state);

  return () => {
    cancel(router);
    rmListener();
  };
}

/**
 * Merge params of all matched levels. Params of deeper levels override
 * the same keys of shallower ones.
 * @group Methods
 * @category Router
 * @param matched matched route levels, see {@link match}
 * @returns the merged params object
 */
export function mergeMatchedParams<R extends BaseRoute = BaseRoute>(
  matched: Matched<R>[]
): Record<string, string> {
  return matched.reduce<Record<string, string>>(
    (params, {params: levelParams}) => ({...params, ...levelParams}),
    {}
  );
}

/**
 * Get current route params from router. Merges params of all matched levels.
 * @group Methods
 * @category Router
 * @param router router instance
 * @returns the params object
 */
export function getParams<R extends BaseRoute = BaseRoute>(
  router: RouterInstance<R>
): Record<string, string> {
  const {index} = getHistoryState(router);
  const matched = router.viewStack[index] as unknown as Matched<R>[] | null;
  if (!matched || !matched.length) return {};
  return mergeMatchedParams(matched);
}
