import {createPath, History, parsePath} from 'history';
import {match as createMatcher} from 'path-to-regexp';
import type {MatchFunction} from 'path-to-regexp';
import type {
  Awaitable,
  Location,
  Matched,
  NavAction,
  Options,
  BaseRoute,
  RouterInstance,
  ResolveView,
  ResolveViewContext,
  HistoryState,
  SearchInput
} from './types';
import {
  parseParams,
  parseSearch,
  parseSearchInput,
  parseSearchSync
} from './search';
import {createCurrentGuard, noop, reject} from './util';
import {
  emitDebugCancel,
  emitDebugCommit,
  emitDebugError,
  emitDebugReplay,
  emitDebugSupersede,
  getDebugInfo,
  markDebugChain,
  onDebug
} from './debug';
import type {DebugChain} from './debug';
import {
  NavigationCancelledError,
  NotFoundError,
  RedirectLoopError
} from './errors';

const DEFAULT_MAX_STACK_DEPTH = 100;

/** Max redirects followed by {@link resolveEntry} before giving up. */
const MAX_REDIRECTS = 10;

/** Default cache lifetime of {@link preload} results, in milliseconds. */
const DEFAULT_PRELOAD_TTL = 30_000;

/**
 * Default bound of concurrently in-flight {@link preload} resolutions.
 * Over the bound the oldest preload is aborted FIFO, so a hover sweep
 * over a list of prefetch links never accumulates unbounded requests.
 */
const DEFAULT_PRELOAD_CONCURRENCY = 4;

/**
 * History's upper-case action, normalized to the {@link NavAction}
 * reported to `listen` callbacks.
 */
const NAV_ACTIONS = {
  PUSH: 'push',
  REPLACE: 'replace',
  POP: 'pop'
} as const;

/**
 * A location resolved through the route guards, together with the view task
 * of its final target. When guards redirected, `location` is the terminal
 * location and `task` resolves the view of the target route.
 */
export type ResolvedEntry<V> = {location: Location; task: Promise<V>};

/**
 * A registered in-flight {@link preload} resolution: the controller its
 * guards/loaders run under and the entry promise handed to callers.
 * FIFO-ordered by registration in {@link RouterCore.preloadInFlight}.
 */
type PreloadFlight<V> = {
  controller: AbortController;
  entry: Promise<ResolvedEntry<V>>;
};

/**
 * Cache record of {@link preload}: the resolution promise of the
 * prefetched target(every hit within the TTL awaits the very same
 * promise, which also deduplicates concurrent callers) plus its
 * expiry timestamp.
 */
type PreloadCacheEntry<V> = {
  entry: Promise<ResolvedEntry<V>>;
  /**
   * Terminal location, filled once the entry resolves. A redirect makes
   * it differ from the cache key, so {@link evictPreloadCache} can drop
   * the pre-redirect slot when the terminal target is committed.
   */
  terminal?: Location;
  expires: number;
};

/**
 * Bookkeeping every {@link create}d router carries on top of
 * {@link RouterInstance}. Declared in this module(instead of types.ts)
 * to keep the public instance type surface stable:
 * - `baseIndex`: absolute history index of `locationStack[0]`. The
 *   physical(window-relative) stack slot of a history entry is
 *   `history index - baseIndex`; entries whose slot falls outside the
 *   memory window re-resolve lazily when landed on.
 * - `preloadCache`: router-level cache of {@link preload} results.
 * - `preloadInFlight`: in-flight {@link preload} resolutions in FIFO
 *   order, bounded by {@link Options.preloadConcurrency}; the oldest
 *   is aborted once the bound is exceeded.
 * - `resolvingController`: the in-flight chain's AbortController. It is
 *   aborted(supersede/cancel) only while the chain is in flight; a
 *   settled chain's controller is left alone so its contexts never
 *   report `aborted` for a navigation that actually committed.
 */
type RouterCore<R extends BaseRoute, V = any> = RouterInstance<R, V> & {
  baseIndex: number;
  preloadCache?: Map<string, PreloadCacheEntry<V>>;
  preloadInFlight?: Map<string, PreloadFlight<V>>;
  resolvingController?: AbortController;
};

/**
 * Create a router instance.
 * @group Methods
 * @category Router
 * @param routes routes config
 * @param history {@link https://www.npmjs.com/package/history history} instance
 * @param resolveView a callback to resolve view. see {@link defaultResolveView}
 * @param options options; `context` bakes in a per-instance value that
 * guards and `resolveView` receive as their {@link GuardContext.context
 * ctx.context}
 * @returns a router instance
 */
export function create<R extends BaseRoute = BaseRoute, V = any, C = undefined>(
  routes: R | R[],
  history: History,
  resolveView: ResolveView<R, V>,
  options?: Options<V, C>
): RouterInstance<R, V, C> {
  type InstanceHistory = RouterInstance<any>['history'];

  const [currentGuard, cancelAll] = createCurrentGuard();
  const instanceHistory = history as InstanceHistory;
  const state = (instanceHistory.location.state || {}) as Partial<HistoryState>;
  const {index} = getHistoryState({history: instanceHistory});
  // Restore the session window from the bounded location window in the
  // current entry state. Window-less legacy(1.x index-only) states degrade
  // to a single-entry window aligned with the landed position.
  const locationStack = restoreLocationStack(instanceHistory);
  const baseIndex = state.locationStack?.length
    ? state.base || 0
    : // Degraded window: its only entry IS the landed position.
      index;
  const router: RouterCore<R, V> = {
    routes: Array.isArray(routes) ? routes : [routes],
    resolveView,

    history: instanceHistory,
    locationStack,
    // The view stack is the SPA-navigation counterpart of the browser's
    // bfcache — a resolved-view snapshot per history entry, restored with
    // zero requests on POP. It is window-relative, so it is exactly as
    // long as the location window and stays bounded by maxStackDepth
    // with it; invalidate() drops these snapshots.
    //
    // viewStack 是 SPA 内导航对应的 bfcache——每个 history 条目一份已解析
    // 视图快照，POP 时零请求还原。它按窗口相对位置存放，与 location 窗口
    // 等长、随 maxStackDepth 一同封顶；invalidate() 丢弃这些快照。
    viewStack: new Array(locationStack.length).fill(null),
    baseIndex,
    preloadCache: new Map(),
    currentGuard,
    cancelAll,

    errorHandler: reject,
    ...options,
    baseUrl: options?.baseUrl || '',
    maxStackDepth: options?.maxStackDepth || DEFAULT_MAX_STACK_DEPTH,
    preloadConcurrency:
      options?.preloadConcurrency || DEFAULT_PRELOAD_CONCURRENCY,
    // Instance context: explicit (not just the spread above) so the
    // member always exists — `undefined` for context-less routers.
    context: options?.context,
    // Observability surface (see src/debug.ts): attached after the
    // options spread so nothing can override them. Purely
    // observational; free when no listener is registered.
    onDebug: (listener) => onDebug(router, listener),
    getDebugInfo: () => getDebugInfo(router)
  };

  if (options?.currentView) {
    const physical = index - baseIndex;
    // Hand-crafted or corrupted state may land the index outside the
    // restored window; skip the write instead of creating a string-keyed
    // property on the array(a negative index would).
    if (physical >= 0 && physical < router.viewStack.length) {
      router.viewStack[physical] = options.currentView;
    }
  }

  return router;
}

export function setOptions<
  R extends BaseRoute = BaseRoute,
  V = any,
  C = undefined
>(
  router: RouterInstance<R, V, C>,
  options: Omit<Options<V, C>, 'currentView'>
) {
  return Object.assign(router, options);
}

export function getLocation({history}: Pick<RouterInstance<any>, 'history'>) {
  const state = (history.location.state || {}) as Partial<HistoryState>;
  return {...history.location, state: state.state};
}

/**
 * Restore the bounded location window serialized in the current history
 * entry state, as-is: entries before the window start are outside the
 * memory window(see {@link RouterCore.baseIndex}) and re-resolve lazily
 * when landed on. Window-less legacy(1.x index-only) state degrades to a
 * single-entry window.
 */
function restoreLocationStack(
  history: RouterInstance<any>['history']
): Location[] {
  const state = (history.location.state || {}) as Partial<HistoryState>;
  return state.locationStack?.length
    ? [...state.locationStack]
    : [getLocation({history})];
}

/**
 * Serialize the memory window together with the absolute index of its
 * first entry, so a refresh can restore it. The memory window is trimmed
 * on every push, so it is already bounded by `maxStackDepth`; the cap
 * only matters when `maxStackDepth` was lowered via
 * {@link setOptions} after the fact.
 */
function serializeStack(router: RouterInstance<any>): {
  base: number;
  locationStack: Location[];
} {
  const {locationStack, maxStackDepth} = router;
  const windowed =
    locationStack.length > maxStackDepth
      ? locationStack.slice(-maxStackDepth)
      : locationStack;
  return {
    base:
      (router as RouterCore<any>).baseIndex +
      (locationStack.length - windowed.length),
    locationStack: windowed
  };
}

function getHistoryState(router: Pick<RouterInstance<any>, 'history'>) {
  const state = (router.history.location.state || {}) as Partial<HistoryState>;
  return {
    index: state.index || 0
  };
}

/**
 * Physical(window-relative) view slot of an absolute history index.
 * Slots before the window start(negative) or past its end read as
 * `undefined`, driving the lazy refresh fallback of {@link listen}.
 */
function viewAt(router: RouterInstance<any>, index: number) {
  return router.viewStack[index - (router as RouterCore<any>).baseIndex];
}

export function getCurrentView<R extends BaseRoute = BaseRoute>(
  router: RouterInstance<R>
) {
  return viewAt(router, getHistoryState(router).index);
}

/**
 * Serialize a level's declared search projection: the picked keys of the
 * array form(in declaration order), or the derived value of the function
 * form. `JSON.stringify` both — the same transform on both sides makes
 * the comparison stable, and `undefined` round-trips as itself.
 */
function searchDepsKey(
  deps: NonNullable<BaseRoute['searchDeps']>,
  input: SearchInput
): string | undefined {
  return JSON.stringify(
    typeof deps === 'function' ? deps(input) : deps.map((key) => input[key])
  );
}

/**
 * The entry a same-route search navigation can re-serve instead of
 * re-resolving: the current view snapshot, wrapped as the target's
 * {@link ResolvedEntry}. `undefined` when the target must resolve for
 * real — the whole point is that "no" is the default:
 *
 * - the pathname differs from the current entry's(a route change always
 *   re-resolves), or the target matches no route at all;
 * - the current entry has no view snapshot(a fresh router, an
 *   `invalidate()`d window, an out-of-window slot);
 * - any level of the matched chain leaves {@link BaseRoute.searchDeps
 *   searchDeps} undeclared — an undeclared level depends on the whole
 *   location, so every navigation re-resolves it, exactly as before
 *   this API existed;
 * - a declared level's projection differs between the current and the
 *   target search — the level consumed something, so the chain re-runs;
 * - the target's raw search fails any matched level's declared
 *   {@link BaseRoute.search search schema}: the fast path validates
 *   synchronously before re-serving, and a failure falls back to the
 *   full resolution so the `SearchError` surfaces through the normal
 *   error channel instead of landing unchecked in the URL. An async
 *   search schema (whose verdict cannot be awaited here) opts its chain
 *   out of the fast path the same way.
 *
 * What is deliberately NOT compared: `hash` and `state` are not resolve
 * inputs, so on a fully declared chain a hash-only navigation is served
 * from the snapshot too. The re-served view keeps its resolve-time
 * context(data, matched `ctx`) — it is the same snapshot object a POP
 * would replay; live search belongs to the framework's search hooks.
 *
 * Used by {@link navigate}; exported for framework navigation setters
 * that commit a replace-style search update through the same semantics
 * (see `@native-router/react`'s `useSetSearch`/`useSearchParams`).
 *
 * @group Methods
 * @category Router
 * @param router router instance
 * @param location the navigation target
 * @returns the reusable entry, or `undefined` when the target must
 * resolve through the guard/view chain
 */
export function reusableEntry<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  location: Location
): ResolvedEntry<V> | undefined {
  const current = router.history.location;
  if (current.pathname !== location.pathname) return undefined;
  const view = getCurrentView(router as RouterInstance<R>) as
    V | null | undefined;
  if (view == null) return undefined;
  const matched = match<R>(router, location.pathname);
  if (!matched) return undefined;
  const prevSearch = parseSearchInput(current.search);
  const nextSearch = parseSearchInput(location.search);
  // An undeclared level opts the whole chain out of the fast path: its
  // resolution may read anything from the location, so "re-resolve on
  // every navigation" — the pre-searchDeps behavior — stays.
  const unchanged = matched.every(({route}) => {
    const {searchDeps} = route;
    return (
      searchDeps !== undefined &&
      searchDepsKey(searchDeps, prevSearch) ===
        searchDepsKey(searchDeps, nextSearch)
    );
  });
  if (!unchanged) return undefined;
  // The fast path must not skip validation a full resolution would run:
  // every matched level's declared search schema validates the target's
  // raw search(`parseSearchInput` → schema, exactly what `parseSearch`
  // feeds it) before the snapshot is re-served. A rejection — or an
  // async schema, whose verdict cannot be known synchronously — abandons
  // the fast path, so the full resolution re-parses the search and
  // surfaces the `SearchError` through its error channel(guard/data
  // phase → `errorHandler`) instead of silently committing an invalid
  // value into the URL. An async schema therefore always opts its chain
  // out of the fast path.
  return matched.every(({route}) => {
    if (!route.search) return true;
    try {
      parseSearchSync(route.search, location.search);
      return true;
    } catch {
      return false;
    }
  })
    ? {location, task: Promise.resolve(view)}
    : undefined;
}

/**
 * Compiled matcher per route object, weakly held. Every compile option
 * is a constant of the route itself — `end` is `!route.children`, the
 * decode option never varies — so a route table is compiled exactly
 * once however often {@link match} runs over it.
 */
const matcherCache = new WeakMap<
  BaseRoute,
  MatchFunction<Record<string, string>>
>();

function matcherOf<R extends BaseRoute>(route: R) {
  if (!route.path) return undefined;
  let matcher = matcherCache.get(route);
  if (!matcher) {
    matcher = createMatcher<Record<string, string>>(route.path, {
      trailing: false,
      sensitive: true,
      decode:
        typeof decodeURIComponent === 'function'
          ? decodeURIComponent
          : undefined,
      end: !route.children
    });
    matcherCache.set(route, matcher);
  }
  return matcher;
}

/**
 * Fold a level's {@link BaseRoute.context route context} over the
 * context its ancestors produced(the route wins on key conflicts). A
 * level without `context` — or a `null`/`undefined` one — contributes
 * nothing, so tables that never declare route contexts keep the exact
 * instance-context value they always had. The merge is a shallow spread
 * of plain objects, mirroring how the runtime merges matched params
 * level by level.
 */
function mergeRouteContext(base: unknown, route: BaseRoute) {
  const routeContext = route.context;
  if (routeContext == null) return base;
  return base == null
    ? {...(routeContext as object)}
    : {...(base as object), ...(routeContext as object)};
}

/**
 * The context the view resolution of a whole matched chain receives:
 * the instance context folded through every level's route context.
 */
function chainContext(
  router: RouterInstance<any>,
  matched: Matched<BaseRoute>[]
) {
  let {context} = router;
  for (let i = 0; i < matched.length; i++) {
    context = mergeRouteContext(context, matched[i].route);
  }
  return context;
}

/** Specificity weights of a path segment: static text > `:param` > `*splat`. */
const SEGMENT_SCORE = {static: 10, dynamic: 3, splat: 2} as const;

/**
 * Score one path segment. `\\`-escaped characters are static text; the
 * first unescaped `:`/`*` classifies a mixed segment(`page-:id`) by its
 * dynamic part — one segment carries exactly one kind of parameter.
 */
function segmentScore(segment: string): number {
  let kind: number = SEGMENT_SCORE.static;
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    if (ch === '\\') {
      // The escaped character is static text, skip it.
      i += 2;
    } else if (ch === ':') {
      kind = SEGMENT_SCORE.dynamic;
      break;
    } else if (ch === '*') {
      kind = SEGMENT_SCORE.splat;
      break;
    } else {
      i++;
    }
  }
  return kind;
}

/**
 * Specificity score of a matched chain: segment scores add up over the
 * whole chain, so more segments(more of the URL pinned down) rank
 * higher than fewer.
 */
function chainScore(chain: Matched<BaseRoute>[]): number {
  let score = 0;
  chain.forEach(({route}) => {
    const path = typeof route.path === 'string' ? route.path : '';
    path.split('/').forEach((segment) => {
      if (segment) score += segmentScore(segment);
    });
  });
  return score;
}

/**
 * Match a path.
 *
 * Every matching chain is collected, then the most specific one wins:
 * per segment static text outranks a dynamic `:param`, which outranks a
 * splat `*wildcard`, and longer chains(whose segments each contribute)
 * outrank shorter ones. Equally specific chains fall back to
 * declaration order. Collecting all chains also fixes sibling
 * short-circuiting: a parent whose prefix matched but whose children
 * all failed no longer hides later siblings.
 *
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
    // eslint-disable-next-line @typescript-eslint/no-shadow
    pathname: string
  ): Matched<R>[][] {
    const chains: Matched<R>[][] = [];
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const matcher = matcherOf(route);
      const matched = matcher
        ? matcher(pathname)
        : {
            path: '',
            index: 0,
            params: {}
          };
      if (matched) {
        const result = {route, ...matched};
        if (route.children) {
          const childChains = matchRoutes(
            route.children,
            pathname.slice(matched.path.length)
          );
          for (let j = 0; j < childChains.length; j++) {
            chains.push([result, ...childChains[j]]);
          }
        } else {
          chains.push([result]);
        }
      }
    }
    return chains;
  }

  const chains = matchRoutes(
    router.routes,
    pathname.slice(router.baseUrl.length)
  );
  // Max-scan instead of sort: strictly-greater replaces, so equal
  // scores keep the DFS enumeration order — declaration order — as the
  // tiebreaker without relying on sort stability.
  let best: Matched<R>[] | undefined;
  let bestScore = -Infinity;
  for (let i = 0; i < chains.length; i++) {
    const score = chainScore(chains[i]);
    if (score > bestScore) {
      best = chains[i];
      bestScore = score;
    }
  }
  return best;
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
      ? resolveView(matched, {
          router,
          location,
          // One-shot resolves(warm-up, direct calls) are never superseded
          // or cancelled: their loaders get a signal that never aborts.
          signal: new AbortController().signal,
          // The instance context folded through every matched level's
          // route context, the same value a guarded resolve hands the
          // view chain. Cast back through the loose `any` the resolve
          // signature(unguarded by the instance's C) always handed
          // over.
          context: chainContext(
            router,
            matched
          ) as ResolveViewContext<R>['context']
        })
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
 * Resolve a location through the route guards(`redirect`/`beforeLoad`).
 *
 * Guards run per matched level from the shallowest to the deepest. A guard
 * returning a path string(redirect) restarts the resolution at the new
 * location — from the shallowest level again, so guards of shallower
 * levels re-run on every hop(keep side-effectful guards idempotent) —
 * carrying the original user state; at most
 * {@link MAX_REDIRECTS 10} redirects are followed before a
 * An unmatched pathname keeps the
 * {@link resolve resolve} behavior: the task rejects with a
 * {@link NotFoundError} and is routed through `router.errorHandler`.
 *
 * `opts.signal` is the abort signal of the whole chain: guards see it in
 * their {@link GuardContext contexts}, the view task's
 * {@link ResolveViewContext context} carries it on, and it is aborted
 * once the navigation is superseded or cancelled. Standalone callers
 * that pass nothing get a signal that never aborts; {@link preload}
 * passes its own controller's signal, which the bounded-concurrency
 * policy may abort once the preload is evicted as the oldest in-flight
 * one.
 *
 * A guard's context also carries the level's parsed
 * {@link GuardContext.search search}: the {@link BaseRoute.search schema}
 * output(its validation failure rejects this resolution with a
 * `SearchError`), or the degraded input without a schema. Its
 * {@link GuardContext.params params} are likewise the merged raw string
 * map unless some level declares a {@link BaseRoute.params params
 * schema} — the deepest schema seen so far has already upgraded them to
 * its output(its validation failure rides the same channel with a
 * `ParamsError`). A deeper level re-declaring a same-name segment with
 * the same raw value keeps the coerced value(a schema-declaring level
 * re-binds it to the raw string so its own schema coerces it); a
 * different raw value is a new binding and the deeper string wins, as
 * the raw deep-over-shallow merge always had it.
 *
 * @group Methods
 * @category Router
 * @param router router instance
 * @param location the location to resolve; the object itself is never
 * mutated — a redirect rebinds the resolution to a new location
 * @param opts options; `signal` is the chain's abort signal
 * @returns the terminal location and its resolve task
 */
export async function resolveEntry<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  location: Location,
  opts?: {signal?: AbortSignal}
): Promise<ResolvedEntry<V>> {
  const {resolveView, errorHandler} = router;
  // The chain owner(navigate/refresh) passes its controller's signal;
  // standalone resolutions get one more controller whose signal never
  // aborts, so downstream consumers always observe a real signal.
  const {signal = new AbortController().signal} = opts ?? {};
  for (let redirects = 0; ; redirects++) {
    if (redirects > MAX_REDIRECTS) {
      throw new RedirectLoopError(location.pathname);
    }
    const matched = match<R>(router, location.pathname);
    if (!matched) {
      return {
        location,
        task: Promise.reject(new NotFoundError(location.pathname)).catch(
          errorHandler
        )
      };
    }

    let redirected = false;
    // Raw params merged level-by-level; a level with a `params` schema
    // upgrades them to the schema output before its guard runs, so
    // guards of deeper levels see coerced params of the whole prefix.
    let params: Record<string, string> = {};
    // The raw binding each key's current schema output was validated
    // against: a deeper schema-less level re-declaring a same-name
    // segment with the SAME raw value keeps the coerced value instead
    // of clobbering it back to the raw string; a different raw value is
    // a new binding, and the deeper string wins (deep-over-shallow on
    // raw params, unchanged).
    const coercedFrom = new Map<string, string>();
    // The instance context folded through the prefix's route contexts:
    // a level's guard sees its ancestors' declarations plus its own —
    // the guard-side twin of the params accumulation above. Loosely
    // typed(the instance's own C is not threaded through this generic)
    // exactly like the instance context handed over today.
    let {context} = router;
    for (let i = 0; i < matched.length; i++) {
      const {route} = matched[i];
      const schemaRuns = route.params !== undefined && !route.redirect;
      const merged: Record<string, string> = {...params};
      // A schema-declaring level re-binds its own segments to their raw
      // strings, so its schema coerces the URL-side value; a schema-less
      // level keeps a coerced value derived from the very same raw
      // binding, and any other re-declaration is a new binding.
      const acc = params;
      Object.entries(matched[i].params).forEach(([key, raw]) => {
        if (!schemaRuns && coercedFrom.get(key) === raw && key in acc) {
          return; // same binding re-declared: keep the coerced value
        }
        merged[key] = raw;
        coercedFrom.delete(key);
      });
      params = merged;
      context = mergeRouteContext(context, route);
      // The level's params schema runs before its guard, so the guard
      // sees the coerced output. A redirect level never runs its guard,
      // so its schema is skipped — the same asymmetry the level's
      // search schema already has(`redirect` wins over `beforeLoad`):
      // hanging a params schema on a redirect level must not be able to
      // fail the navigation, its only observable effect would be the
      // failure. A validation failure fails the resolution through the
      // task's errorHandler channel — the same route a search-schema
      // failure takes — instead of rejecting this entry, which preload
      // consumers share.
      if (schemaRuns) {
        try {
          const input = params;
          // eslint-disable-next-line no-await-in-loop -- guards must run in declaration order, sequentially
          params = (await parseParams(route.params!, params)) as Record<
            string,
            string
          >;
          const output = params;
          // Every surviving key is now a schema output: string inputs
          // record the raw binding they were validated against, so a
          // deeper schema-less re-declaration of the same binding keeps
          // the coerced value; non-string inputs were pass-throughs of
          // an already-coerced value and keep their earlier raw root.
          // Keys the schema dropped lose their record — a deeper
          // re-declaration of such a name re-binds to its raw string.
          Object.keys(input).forEach((key) => {
            if (!(key in output)) coercedFrom.delete(key);
            else if (typeof input[key] === 'string')
              coercedFrom.set(key, input[key] as string);
          });
        } catch (e) {
          return {
            location,
            task: Promise.reject(e).catch(errorHandler)
          };
        }
      }
      // `redirect` wins over `beforeLoad`; a non-empty string target
      // restarts the resolution at the redirected location.
      let target: string | Awaitable<string | void> | undefined =
        route.redirect;
      if (!target && route.beforeLoad) {
        // The level's search schema runs before its guard, so the guard
        // sees the parsed output(degraded input without a schema). A
        // validation failure fails the resolution through the task's
        // errorHandler channel — the same route a data-phase search
        // error takes — instead of rejecting this entry, which preload
        // consumers share.
        let search: unknown;
        if (route.search) {
          try {
            // eslint-disable-next-line no-await-in-loop -- guards must run in declaration order, sequentially
            search = await parseSearch(route.search, location.search);
          } catch (e) {
            return {
              location,
              task: Promise.reject(e).catch(errorHandler)
            };
          }
        } else {
          search = parseSearchInput(location.search);
        }
        // eslint-disable-next-line no-await-in-loop -- guards must run in declaration order, sequentially
        target = await route.beforeLoad({
          router,
          location,
          params,
          signal,
          search,
          context
        });
      }
      if (target) {
        location = toLocation(router, target, location.state);
        redirected = true;
        break;
      }
    }
    // eslint-disable-next-line no-continue -- the redirect loop restarts the outer resolution pass
    if (redirected) continue;

    return {
      location,
      task: resolveView(matched, {
        router,
        location,
        signal,
        // The full-chain fold: every matched level's route context over
        // the instance context. Frameworks re-derive the per-level
        // prefix for their data loaders(see `@native-router/react`).
        context
      }).catch(errorHandler)
    };
  }
}

/**
 * Resolve a target through the route guards(`redirect`/`beforeLoad`) and
 * cache the result at the router level, keyed by `pathname + search`.
 *
 * Within its TTL(`opts.ttl`, default 30s) repeated and concurrent calls
 * return the very same entry promise, so concurrent callers share one
 * resolution(in-flight dedup) and repeated prefetches reuse the resolved
 * view task instead of re-running guards and `resolveView`. A rejected
 * resolution(guard error, redirect loop) is evicted from the cache, so
 * the next call retries it. Committing a navigation({@link commit} or
 * {@link commitReplace}) consumes the entry and evicts its cache slot —
 * a later preload re-resolves fresh state, while callers still holding
 * the old entry keep their references.
 *
 * Prefetches are bounded and cancelable: each resolution owns an
 * `AbortController` handed to its guards and loaders as their
 * `ctx.signal`, and once more than {@link Options.preloadConcurrency}
 * (default 4) preloads are in flight the oldest is aborted FIFO — its
 * cache slot is dropped and its failure is swallowed as background
 * noise, so a hover sweep over a list of prefetch links never
 * accumulates unbounded requests. A preload consumed by a committing
 * navigation is never aborted: consumption detaches it from the bound.
 *
 * @group Methods
 * @category Router
 * @param router router instance
 * @param to path string
 * @param opts options; `ttl` is the cache lifetime in milliseconds
 * @returns the terminal location and its resolve task
 */
export function preload<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  to: string,
  opts?: {ttl?: number}
): Promise<ResolvedEntry<V>> {
  const cache = preloadCacheOf<V>(router);
  const location = toLocation<R, V>(router, to);
  const key = preloadLocationKey(location);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expires) {
    return cached.entry;
  }
  prunePreloadCache(cache);
  // The preload owns its controller: guards and loaders observe its
  // signal, and the bounded-concurrency policy below may abort it.
  const controller = new AbortController();
  const entry = resolveEntry<R, V>(router, location, {
    signal: controller.signal
  });
  const record: PreloadCacheEntry<V> = {
    entry,
    expires: Date.now() + (opts?.ttl ?? DEFAULT_PRELOAD_TTL)
  };
  cache.set(key, record);
  entry.then(
    (resolved) => {
      record.terminal = resolved.location;
    },
    () => {
      // Never cache a failure: evict the slot(this record only, a newer
      // preload may already have replaced it) so the next call retries.
      if (cache.get(key)?.entry === entry) cache.delete(key);
    }
  );
  trackPreloadFlight<V>(router, key, {controller, entry});
  return entry;
}

/**
 * Register an in-flight preload and enforce the concurrency bound:
 * over {@link Options.preloadConcurrency} in-flight preloads the
 * oldest(FIFO head) is aborted and evicted — its resolution dies as
 * background noise instead of piling up. Map iteration order is
 * insertion order, so the queue order is registration order; a
 * re-preloaded key re-queues at the tail. Flights leave the window on
 * their own once the entry AND its view task settle.
 */
function trackPreloadFlight<V>(
  router: RouterInstance<any, V>,
  key: string,
  flight: PreloadFlight<V>
) {
  const core = router as RouterCore<any, V>;
  if (!core.preloadInFlight) core.preloadInFlight = new Map();
  const inFlight = core.preloadInFlight;
  inFlight.delete(key);
  inFlight.set(key, flight);
  const leave = () => {
    if (inFlight.get(key) === flight) inFlight.delete(key);
  };
  flight.entry.then((resolved) => {
    resolved.task.then(leave, leave);
  }, leave);
  const limit = core.preloadConcurrency || DEFAULT_PRELOAD_CONCURRENCY;
  while (inFlight.size > limit) {
    const oldestKey = inFlight.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = inFlight.get(oldestKey)!;
    inFlight.delete(oldestKey);
    // Stop the superseded prefetch's requests: guards and loaders
    // observing the signal bail out instead of finishing in the dark.
    oldest.controller.abort();
    // Background semantics: the abort is not an error anyone observes,
    // and the cache slot is dropped so a later call re-resolves fresh.
    const record = core.preloadCache?.get(oldestKey);
    if (record?.entry === oldest.entry) core.preloadCache?.delete(oldestKey);
    oldest.entry.catch(noop);
  }
}

/**
 * Detach the preloads of a committed target from the concurrency
 * bound: their resolution is now the navigation chain itself, so an
 * eviction abort must never kill them. Mirrors {@link evictPreloadCache}
 * — the direct key plus redirecting records whose terminal resolves to
 * the committed location.
 */
function consumePreloadFlights<V>(
  router: RouterInstance<any, V>,
  location: Location
) {
  const core = router as RouterCore<any, V>;
  if (!core.preloadInFlight?.size) return;
  const key = preloadLocationKey(location);
  core.preloadInFlight.forEach((flight, k) => {
    const record = core.preloadCache?.get(k);
    if (
      k === key ||
      (record?.terminal !== undefined &&
        preloadLocationKey(record.terminal) === key)
    ) {
      core.preloadInFlight!.delete(k);
    }
  });
}

function preloadLocationKey(location: Location) {
  return location.pathname + location.search;
}

/**
 * Drop expired records. Runs on every cache write, so distinct prefetched
 * targets never accumulate beyond their TTL in a long session.
 */
function prunePreloadCache<V>(cache: Map<string, PreloadCacheEntry<V>>) {
  const now = Date.now();
  cache.forEach((record, key) => {
    if (record.expires <= now) cache.delete(key);
  });
}

/**
 * Evict the cache slots consumed by a committed navigation. A redirecting
 * entry is cached under its pre-redirect key while its terminal location
 * differs, so records whose terminal resolves to the committed location
 * are dropped too; in-flight records(terminal not yet known) are left to
 * the TTL.
 */
function evictPreloadCache<V>(
  router: RouterInstance<any, V>,
  location: Location
) {
  const cache = preloadCacheOf<V>(router);
  const key = preloadLocationKey(location);
  cache.delete(key);
  cache.forEach((record, k) => {
    if (record.terminal && preloadLocationKey(record.terminal) === key) {
      cache.delete(k);
    }
  });
}

function preloadCacheOf<V>(
  router: RouterInstance<any, V>
): Map<string, PreloadCacheEntry<V>> {
  const core = router as RouterCore<any, V>;
  // create() always seeds the cache; the lazy path keeps hand-built
  // router-shaped objects working.
  return (core.preloadCache ??= new Map());
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
  // Blockers sit at the chain head: a vetoed external commit is dropped
  // before the given task is ever awaited. The dropped task still gets
  // a rejection handler — an orphaned failure(preload tasks re-throw
  // NotFoundError through the default errorHandler) would otherwise
  // surface as an unhandled rejection.
  if (blockedBy(router, createPath(location))) {
    resolvePromise.catch(noop);
    return Promise.resolve();
  }
  // This commit consumes a preload entry(a typical caller hands over
  // `preload()`'s resolved task): its resolution is now the navigation
  // chain itself, so the concurrency bound must never abort it.
  consumePreloadFlights<V>(router, location);
  // Wrap the raw task so external callers share the guarded entry
  // pipeline; the entry location is the given one, as-is.
  return pushEntry(
    router as RouterCore<R, V>,
    Promise.resolve({location, task: resolvePromise} as ResolvedEntry<V>),
    location
  );
}

function pushEntry<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterCore<R, V>,
  entryPromise: Promise<ResolvedEntry<V>>,
  fromLocation: Location,
  ac?: AbortController
): Promise<void> {
  const {history} = router;
  const nextIndex = getHistoryState(router).index + 1;
  return commitBase(
    router,
    entryPromise,
    fromLocation,
    ac,
    (resolvedView, entry) => {
      const {location} = entry;
      let next = nextIndex - router.baseIndex;
      if (next < 0 || next > router.locationStack.length) {
        // The current entry sits outside the memory window(a push while an
        // out-of-window lazy refresh is still pending): restart the window
        // at the pushed position. Out-of-window neighbours re-resolve
        // lazily when landed on.
        router.baseIndex = nextIndex;
        router.locationStack = [];
        router.viewStack = [];
        next = 0;
      }
      router.locationStack = [...router.locationStack.slice(0, next), location];
      router.viewStack = [...router.viewStack.slice(0, next), resolvedView];
      // Bound the memory window: evict the oldest entries once the stack
      // outgrows maxStackDepth, shifting the window base along.
      if (router.locationStack.length > router.maxStackDepth) {
        const evicted = router.locationStack.length - router.maxStackDepth;
        router.locationStack = router.locationStack.slice(evicted);
        router.viewStack = router.viewStack.slice(evicted);
        router.baseIndex += evicted;
      }
      history.push(location, {
        index: nextIndex,
        state: location.state,
        ...serializeStack(router)
      });
    },
    'push'
  );
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
  // Same chain-head veto as commit: a blocked replace never starts, and
  // the dropped task's failure is swallowed the same way.
  if (blockedBy(router, createPath(location))) {
    resolvePromise.catch(noop);
    return Promise.resolve();
  }
  // Same consumption detach as commit: a replaced-in preload entry must
  // not be aborted by the concurrency bound while it commits.
  consumePreloadFlights<V>(router, location);
  return replaceEntry(
    router as RouterCore<R, V>,
    Promise.resolve({location, task: resolvePromise} as ResolvedEntry<V>),
    location
  );
}

function replaceEntry<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterCore<R, V>,
  entryPromise: Promise<ResolvedEntry<V>>,
  fromLocation: Location,
  ac?: AbortController,
  action: NavAction = 'replace'
): Promise<void> {
  const {history} = router;
  const {index} = getHistoryState(router);
  return commitBase(
    router,
    entryPromise,
    fromLocation,
    ac,
    (resolvedView, entry) => {
      const {location} = entry;
      const physical = index - router.baseIndex;
      if (physical < 0 || physical >= router.locationStack.length) {
        // The landed entry is outside the memory window(the browser evicted
        // older history past the window, or a window-less legacy state).
        // Restart the window at the landed position — placeholders for the
        // unknown gap slots are gone, so neighbouring out-of-window entries
        // re-resolve lazily on every POP, consistent with the rare
        // browser-evicted paths.
        router.baseIndex = index;
        router.locationStack = [location];
        router.viewStack = [resolvedView];
      } else {
        router.locationStack[physical] = location;
        router.viewStack[physical] = resolvedView;
      }
      history.replace(location, {
        index,
        state: location.state,
        ...serializeStack(router)
      });
    },
    action
  );
}

function commitBase<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  entryPromise: Promise<ResolvedEntry<V>>,
  location: Location,
  ac: AbortController | undefined,
  onResolved: (resolvedView: V, entry: ResolvedEntry<V>) => void,
  action: NavAction
): Promise<void> {
  const core = router as RouterCore<R, V>;
  // A pending rewind(a vetoed POP's counter-`go()`, still in flight in
  // real browsers where popstate lands asynchronously) is superseded by
  // this user-driven commit: the forward navigation wins, the rewind is
  // canceled. The browser may still deliver the rewind traversal's own
  // POP afterwards — without the pending mark it walks the normal POP
  // path, so the blockers re-decide with the freshly committed entry as
  // `from`, instead of the traversal being swallowed as a "rewind
  // landing" that re-announces a view at an index the rewind was never
  // aimed at.
  cancelPendingRewind(router);
  const {currentGuard, onLoadingChange = noop} = router;
  if (router.resolving) {
    // Cancel current resolve
    onLoadingChange();
    // ...and stop its requests: the guard below discards the superseded
    // chain's result, so its in-flight guards/loaders must not keep
    // consuming the network until they settle on their own.
    core.resolvingController?.abort();
    // The superseded chain's own debug terminal event — its promise
    // rejects with NavigationCancelledError, which carries no "who
    // replaced me" detail.
    emitDebugSupersede(core, createPath(location));
  }
  router.resolving = location;
  // External commits(plain tasks from resolveTo/preload) carry no
  // controller; clearing the slot keeps a stale one from being aborted
  // by a later supersede.
  core.resolvingController = ac;
  onLoadingChange('pending');
  // The chain's observability record(also what getDebugInfo reports as
  // `resolving`) plus its nav-start event.
  const debugChain: DebugChain = markDebugChain(core, action, location);
  return (
    // The whole chain — route guards AND the view task — is guarded from
    // the very start: a superseding navigation or a cancel() while slow
    // guards are still running rejects this chain's promise with a
    // NavigationCancelledError, exactly like during the view phase —
    // eagerly, without waiting for the superseded resolve to settle.
    currentGuard(
      entryPromise.then((entry) =>
        entry.task.then((resolvedView) => ({entry, resolvedView}))
      ),
      () => new NavigationCancelledError(createPath(location))
    )
      .then(({entry, resolvedView}) => {
        // This chain settled: it is no longer in flight. Clearing the
        // mark BEFORE onResolved matters because onResolved commits
        // history, which synchronously re-enters cancel() through the
        // router's own listen() handler — an already-settled chain must
        // not be aborted(or fire a cancel signal) as if it were still
        // running. Only the current chain can reach here — superseded
        // chains were rejected — so the mark is always ours to clear.
        router.resolving = undefined;
        onResolved(resolvedView, entry);
        // The navigation consumed this resolution: drop its preload
        // cache slots so a later preload re-resolves fresh state.
        evictPreloadCache<V>(router, entry.location);
        return entry;
      })
      .then((entry) => {
        onLoadingChange('resolved');
        // The commit event reports the chain's terminal location — a
        // guard redirect may have moved it away from the request.
        emitDebugCommit(core, debugChain, entry.location);
      })
      .catch((e) => {
        // A discarded chain rejects with NavigationCancelledError, but
        // the in-flight mark and the loading signal belong to whoever
        // discarded it — cancel() cleared the mark and fired
        // onLoadingChange() itself, a superseding chain reset both for
        // itself. Touching them here would clobber the winner's state;
        // the rejection itself still propagates to the awaiter.
        if (e instanceof NavigationCancelledError) throw e;
        router.resolving = undefined;
        onLoadingChange('rejected');
        emitDebugError(core, debugChain, e);
        throw e;
      })
  );
}

/**
 * Navigate to a new path. Route guards(`redirect`/`beforeLoad`) run before
 * the view resolves; the history entry is committed on the terminal
 * location when guards redirected. A registered blocker(see {@link
 * setBlocker}) may veto the navigation before anything starts. The guard
 * phase is part of the
 * cancelable navigation: a superseding navigate or a `cancel()` while
 * guards are still running discards this navigation — the returned
 * promise rejects with a {@link NavigationCancelledError} — and aborts
 * the chain's `signal`, so guards and loaders observing it({@link
 * GuardContext.signal}, {@link ResolveViewContext.signal}) stop their
 * requests instead of only having their results dropped. A vetoed
 * navigation instead resolves normally: a veto is the user saying no, a
 * normal outcome; being discarded is a failure for the awaiter.
 * Fire-and-forget call sites attach a no-op catch.
 *
 * Same-route search navigations take the {@link BaseRoute.searchDeps
 * searchDeps} fast path: when every level of the matched chain declares
 * its consumed search keys and the declared projection is unchanged, the
 * current view snapshot is re-served as the new entry({@link
 * reusableEntry}) — no guards, no loaders, no lazy imports, exactly like
 * a POP hitting the `viewStack`. Undeclared chains resolve on every
 * navigation as always.
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
  // Blockers sit at the chain head, before the controller exists: a
  // vetoed navigation never resolves a single guard, and its promise
  // resolves immediately — a veto is the user saying no, a normal
  // outcome, not an error. A cancelled/superseded navigation instead
  // rejects with a NavigationCancelledError: it died by replacement,
  // which is a failure for its awaiter. Fire-and-forget call sites that
  // never await attach a no-op catch(the react bindings' Link and
  // setters do) to keep the rejection out of the unhandled channel.
  // The target is asked in its committed path form(`createPath`), the
  // same string a POP blocker sees, baseUrl included.
  if (blockedBy(router, createPath(location))) return Promise.resolve();
  // The searchDeps fast path: a same-route navigation with an unchanged
  // declared projection commits the current view snapshot directly. No
  // controller — there is nothing in flight to abort — but the entry
  // still rides the guarded commit pipeline(supersede/cancel/blockers on
  // the push itself, onLoadingChange, stack bookkeeping).
  const reusable = reusableEntry<R, V>(router, location);
  if (reusable) {
    return pushEntry(
      router as RouterCore<R, V>,
      Promise.resolve(reusable),
      location
    );
  }
  // One controller per navigation round: guards and view loaders of the
  // whole chain(including redirect hops) share its signal.
  const ac = new AbortController();
  return pushEntry(
    router as RouterCore<R, V>,
    resolveEntry<R, V>(router, location, {signal: ac.signal}),
    location,
    ac
  );
}

/**
 * Refresh the page. Route guards run before the view resolves; a redirect
 * replaces the current entry with the terminal location. The refresh is a
 * cancelable navigation chain like {@link navigate}: superseding it or
 * `cancel()` aborts its signal.
 * @group Methods
 * @category Router
 * @param router router instance
 */
export function refresh<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>
) {
  return refreshEntry(router, 'replace');
}

/**
 * The refresh pipeline with an explicit navigation action, so the lazy
 * re-resolve of a landed history entry(see {@link listen}) can report
 * the landing's own kind to observability consumers while still
 * committing through the replace pipeline, exactly like the public
 * {@link refresh} does.
 */
function refreshEntry<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  action: NavAction
) {
  const location = getLocation(router);
  const ac = new AbortController();
  return replaceEntry(
    router as RouterCore<R, V>,
    resolveEntry<R, V>(router, location, {signal: ac.signal}),
    location,
    ac,
    action
  );
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
 * Cancel the current navigate. The in-flight chain's guards/loaders are
 * aborted through their signal, not merely discarded, and the
 * navigation's promise rejects with a {@link NavigationCancelledError}
 * — eagerly, without waiting for the aborted resolve to settle.
 * @group Methods
 * @category Router
 * @param router router instance
 */
export function cancel<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>
) {
  const core = router as RouterCore<R, V>;
  // Aborting is reserved for chains that are still running: a chain that
  // just committed re-enters cancel() synchronously through listen()'s
  // history handler and must not have its(possibly still-rendered) view
  // contexts aborted after the fact.
  if (router.resolving) {
    // The cancelled chain's own debug terminal event — emitted before
    // the abort so listeners see the decision, not its aftermath.
    emitDebugCancel(router);
    core.resolvingController?.abort();
    core.resolvingController = undefined;
  }
  // The cancelled chain's promise was already rejected eagerly (its
  // awaiter saw a NavigationCancelledError), and nothing else will
  // clear the in-flight mark: drop it here, or a later navigation would
  // fire a spurious cancel signal(`onLoadingChange()`) for a dead
  // resolve.
  router.resolving = undefined;
  router.cancelAll();
  router.onLoadingChange?.();
}

/**
 * Default bound of concurrently in-flight {@link initHistoryStack}
 * warm-up resolutions. Refreshing a full window(≤ maxStackDepth, 100 by
 * default) would otherwise fan every entry's guards/loaders out at once
 * and saturate the network exactly when the page is already busy
 * reloading — the same reason {@link preload} is bounded. Entries simply
 * queue(FIFO by stack order) instead of being aborted: a warm-up has no
 * winner to prioritize, every entry is wanted eventually.
 */
const DEFAULT_INIT_CONCURRENCY = 4;

/**
 * Restore/warm up the view stack by re-resolving every reachable entry
 * of the in-memory location stack. Call it after a refresh: in-window
 * back/forward then switch views without new resolves.
 *
 * Warm-up resolutions are bounded(see {@link
 * DEFAULT_INIT_CONCURRENCY}): at most 4 entries resolve at once, the
 * rest queue FIFO in stack order. A single entry that fails(its
 * `errorHandler` may re-reject) leaves its slot empty — the lazy
 * re-resolve path of {@link listen} picks it up again if the user
 * actually lands on it — and never fails the whole warm-up.
 *
 * 恢复/预热内存栈中的可达条目（窗口内有 location 的槽位），刷新后调用
 * 可让窗口内前进/后退零请求。并发上限 4，单条失败不整体中断，失败槽位
 * 留空待惰性重解析。
 * @group Methods
 * @category Router
 * @param router router instance
 */
export function initHistoryStack<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>
) {
  const {locationStack} = router;
  const views: (V | null)[] = new Array(locationStack.length).fill(null);
  let cursor = 0;
  let active = 0;
  return new Promise<void>((done) => {
    const pump = () => {
      const warm = (slot: number) => {
        active++;
        resolve<R, V>(router, locationStack[slot])
          .then(
            (view) => {
              views[slot] = view;
            },
            // A failed entry degrades to an unwarmed slot(null) — the POP
            // lazy-refresh path re-resolves it on landing — instead of
            // failing the whole warm-up.
            () => {}
          )
          .then(() => {
            active--;
            pump();
          });
      };
      while (
        active < DEFAULT_INIT_CONCURRENCY &&
        cursor < locationStack.length
      ) {
        warm(cursor++);
      }
      if (active === 0 && cursor >= locationStack.length) done();
    };
    pump();
  }).then(() => {
    // Unwarmed slots hold `null`, the same hole value invalidate()
    // writes; the stack type stays V[] for unchanged public surface.
    router.viewStack = views as V[];
  });
}

/**
 * Drop every view snapshot of the session window. The already rendered
 * view is untouched — no re-resolve, no re-render; only future POPs
 * change: with no snapshot to hit, {@link listen} falls back to the same
 * lazy re-resolve path as out-of-window entries, so the landed entry's
 * guards(`redirect`/`beforeLoad`) and loaders run again. Call it when
 * the snapshots stop being valid — e.g. right after a logout or an
 * account switch, so a back POP cannot render the previous account's
 * view or bypass guards that already ran in the session.
 *
 * 丢弃会话窗口内的全部视图快照。已渲染的当前视图不受影响——不重解析、
 * 不重渲染；变化的只有后续 POP：无快照可命中时，listen 落入与窗口外条目
 * 相同的惰性重解析路径，落点条目的守卫与加载器重新执行。快照失效时调用
 * ——例如登出/切换账号后，后退 POP 不再渲染上一账号的视图、也不再绕过
 * 会话内已执行过的守卫。
 * @group Methods
 * @category Router
 * @param router router instance
 */
export function invalidate<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>
) {
  // Keep the window shape: locationStack stays untouched, so getParams
  // and the serialized window keep working — only the snapshots go.
  router.viewStack = new Array(router.locationStack.length).fill(null);
}

/**
 * Navigation blocker predicate: `to` and `from` are path strings
 * (pathname, search and hash included, built with `createPath`). Return
 * `false` to veto the navigation. A blocker that throws counts as a
 * veto too — a crashed gate must not open, and the exception must not
 * escape into a history listener.
 * @group Methods
 * @category Router
 */
export type BlockerFn = (to: string, from: string) => boolean;

/**
 * Registered blockers per router, in registration order. Module-level
 * so the public {@link RouterInstance} type stays untouched; the router
 * key is weakly held, an empty leftover set after the last release
 * leaks nothing.
 */
const blockerRegistry = new WeakMap<RouterInstance<any>, Set<BlockerFn>>();

/**
 * Last settled history position per router, kept in sync by {@link listen}.
 * POP blockers read it as the `from` path and the rewind base: by the
 * time a POP listener runs, `history.location` is already the landed
 * location, so the pre-POP position must be tracked separately.
 */
const lastSettled = new WeakMap<
  RouterInstance<any>,
  {index: number; location: Location}
>();

/**
 * Pending blocker rewind per router: a rewind `go()` is in flight. The
 * rewind's own POP must not query the blockers again — they would veto
 * it too and ping-pong the history forever — and it is canceled by the
 * commit pipeline when a user-driven navigation supersedes it(see
 * {@link cancelPendingRewind}).
 */
const pendingRewind = new WeakMap<RouterInstance<any>, true>();

/**
 * Cancel a pending rewind: the next POP the router observes is no
 * longer the rewind's own landing. Called by the commit pipeline(see
 * {@link commitBase}) the moment a user-driven navigation begins while
 * a vetoed POP's rewind `go()` is still in flight — the forward
 * navigation wins, and the rewind traversal's late POP walks the normal
 * POP path(blockers re-asked, `from` the freshly committed entry)
 * instead of being mistaken for the rewind's landing.
 */
function cancelPendingRewind(router: RouterInstance<any>) {
  pendingRewind.delete(router);
}

/**
 * Register a navigation blocker. Every {@link navigate}, {@link commit},
 * {@link commitReplace} and every history POP(see {@link listen}) asks
 * the registered blockers(in registration order, first veto wins)
 * before anything else; a vetoed navigation never starts — no guards,
 * no loaders, no history change — and its promise resolves immediately
 * (a veto is the user saying no, a normal outcome, not an error; a
 * cancelled or superseded navigation instead rejects with a
 * NavigationCancelledError). `refresh` and guard redirects
 * are never blocked: a refresh re-resolves the current location, and a
 * redirect is the guard chain's own target correction, already asked
 * once at the chain head. A vetoed POP is rewound with a
 * counter-`go()`; its landing re-announces the current view without
 * cancelling an in-flight chain.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param fn blocker predicate; `to` is the target path, `from` the
 * current path, both path strings
 * @returns unblock - remove the blocker(idempotent)
 */
export function setBlocker<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  fn: BlockerFn
): () => void {
  let set = blockerRegistry.get(router);
  if (!set) {
    set = new Set();
    blockerRegistry.set(router, set);
  }
  set.add(fn);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    set.delete(fn);
  };
}

/**
 * Ask every registered blocker, in registration order. The first veto
 * wins — `some` stops asking at it — and a blocker that throws counts
 * as a veto: a crashed gate must not open, and the exception must not
 * escape into a history listener.
 */
function vetoedBy(set: Set<BlockerFn>, to: string, from: string) {
  return Array.from(set).some((block) => {
    try {
      return !block(to, from);
    } catch {
      return true;
    }
  });
}

/**
 * Ask the blockers about a router-driven navigation. Runs before
 * anything else, so `history.location` is still the pre-navigation
 * `from`. Returns `true` when any blocker vetoed.
 */
function blockedBy(router: RouterInstance<any>, to: string) {
  const set = blockerRegistry.get(router);
  if (!set) return false;
  return vetoedBy(set, to, createPath(router.history.location));
}

/**
 * Ask the blockers about a history POP; rewind it when vetoed.
 * Returns the POP's disposition for {@link listen}:
 * - `'vetoed'`: a blocker vetoed. The caller drops the event wholesale
 *   — no `onViewChange`, no window sync, and no `cancel()` either, so
 *   an in-flight chain keeps running as if the POP never happened.
 * - `'rewind'`: this POP is the landing of an earlier veto's rewind,
 *   back on the entry the router never left. The router state did not
 *   change, so the caller re-announces the current view without
 *   cancelling the in-flight chain or re-syncing the window state.
 * - `false`: not blocked; the caller handles the POP normally.
 */
function blockedPop(
  router: RouterInstance<any>,
  location: Location,
  index: number
): 'vetoed' | 'rewind' | false {
  const {history} = router;
  // A pending rewind's own landing: swallow it without a second query
  // (a blocker that vetoes leaving a page would veto the rewind too)
  // and report it for the no-cancel re-announce branch in the caller.
  // Deliberately not index-matched: a user POP racing the pending
  // rewind must never re-enter the blockers either.
  if (pendingRewind.delete(router)) return 'rewind';

  const set = blockerRegistry.get(router);
  if (!set) return false;
  // Without a settled baseline(unreachable while this listener exists:
  // listen() seeds the tracker before registering) there is neither a
  // `from` nor a rewind delta to work with — let the POP land rather
  // than veto blind.
  const settled = lastSettled.get(router);
  if (!settled) return false;
  const to = createPath(location);
  const from = createPath(settled.location);
  if (!vetoedBy(set, to, from)) return false;
  // Rewind by the distance the POP travelled. Router-driven pushes keep
  // the state index and the history index in lockstep, so the delta
  // between the landed and settled state indexes doubles as the history
  // delta.
  const delta = index - settled.index;
  if (delta) {
    pendingRewind.set(router, true);
    history.go(-delta);
  } else {
    // Zero delta(same-index POP between stateless external entries)
    // cannot be rewound — `go(0)` goes nowhere — so the settled URL is
    // restored with a replace instead, keeping the address bar, the
    // state index and the rendered view on the entry the router never
    // left. Trade-off: unlike a rewind POP, the restore rewrites the
    // landed entry's state, which is exactly what we want here — the
    // vetoed target was never part of the session. The pending mark
    // routes the restore's own synchronous REPLACE landing through the
    // no-cancel re-announce branch in {@link listen}, the same
    // semantics a rewind landing gets: an in-flight chain survives the
    // veto untouched.
    pendingRewind.set(router, true);
    history.replace(createPath(settled.location), {
      index: settled.index,
      // `settled.location` is a raw history location, so its `state` is
      // the wrapped {index, state?, ...} record — unwrap the user state
      // the settled entry carried(see getLocation) instead of nesting
      // the wrapper a level deeper.
      state: ((settled.location.state || {}) as Partial<HistoryState>).state,
      ...serializeStack(router)
    });
  }
  return 'vetoed';
}

/**
 * Listen the history change.
 * @group Methods
 * @category Router
 * @param router router instance
 * @param onViewChange a callback function will be call when view changed,
 * with the navigation action(`'push' | 'replace' | 'pop'`, see
 * {@link NavAction}) as the second argument — existing single-argument
 * callbacks stay valid
 * @returns unlisten - A function that may be used to stop listening
 */
export function listen<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  onViewChange: (v: V, action: NavAction) => void
) {
  const {history} = router;

  // Seed the settled-position tracker so a POP arriving before any other
  // history change still reads a correct `from` and rewind delta.
  lastSettled.set(router, {
    index: getHistoryState(router).index,
    location: history.location
  });

  const rmListener = history.listen(({action, location}) => {
    const state = location.state as HistoryState | undefined;
    const index = state?.index || 0;
    // History's upper-case action, normalized to the NavAction reported
    // to onViewChange callbacks.
    const navAction: NavAction = NAV_ACTIONS[action];

    if (action === 'POP') {
      const blocked = blockedPop(
        router as RouterInstance<any>,
        location,
        index
      );
      // A blocker veto runs before anything else: the POP is rewound
      // with a counter-`go()`, so neither the view nor the in-flight
      // chain may observe it.
      if (blocked === 'vetoed') return;
      if (blocked === 'rewind') {
        // The rewind's landing: an entry the router never left. The
        // stacks and the landed entry's window state are already
        // correct — no sync replace — and no `cancel()` either: an
        // in-flight chain must survive the bounced POP. Re-announce
        // the current view only when a snapshot exists; an
        // invalidate()d slot emits nothing and the host keeps its
        // retained view, exactly like invalidate() itself — a lazy
        // refresh here would supersede the very chain this branch
        // protects.
        const view = viewAt(router, index);
        if (view) onViewChange(view, 'pop');
        lastSettled.set(router, {index, location});
        return;
      }
    } else if (action === 'REPLACE' && pendingRewind.delete(router)) {
      // The zero-delta veto's URL restore: its own landing, the same
      // semantics a rewind POP gets — the router never left this entry,
      // so re-announce without cancelling an in-flight chain. The mark
      // is only ever pending across a commit(canceled there, see
      // cancelPendingRewind) or a rewind landing, so no ordinary
      // replace is mistaken for a restore.
      const view = viewAt(router, index);
      if (view) onViewChange(view, 'replace');
      lastSettled.set(router, {index, location});
      return;
    }

    cancel(router);
    const view = viewAt(router, index);

    onViewChange(view, navAction);
    if (!view) {
      // Lazy fallback for out-of-window slots and window-less legacy
      // state: re-resolving the landed entry also re-serializes the
      // window into it via the replace commit. A guard failure here
      // must not surface as an unhandled rejection — the landed entry
      // simply keeps its(unknown) view. The chain reports the landing's
      // own action to debug consumers while committing through the
      // replace pipeline.
      refreshEntry<R, V>(router, navAction).catch(noop);
    } else if (action === 'POP') {
      // Sync the current window into the landed entry so a later
      // refresh("refresh → back → refresh again") still restores it.
      history.replace(createPath(history.location), {
        ...state,
        index,
        ...serializeStack(router)
      });
      // The snapshot replay's standalone commit event: no chain ever
      // started, zero requests resolved this landing.
      emitDebugReplay(router, location);
    }
    lastSettled.set(router, {index, location});
  });

  history.replace(createPath(history.location), history.location.state);

  return () => {
    cancel(router);
    rmListener();
  };
}

/**
 * Merge params of the matched levels. Params of deeper levels override
 * the same keys of shallower ones.
 *
 * When `end` is given, only the levels up to and including `end` are
 * merged — the accumulated params a level at index `end` sees(shallow →
 * current level). Omitting `end` merges every level.
 * @group Methods
 * @category Router
 * @param matched matched route levels, see {@link match}
 * @param end the index of the last level to merge, defaults to the deepest
 * @returns the merged params object
 */
export function mergeMatchedParams<R extends BaseRoute = BaseRoute>(
  matched: Matched<R>[],
  end?: number
): Record<string, string> {
  return matched
    .slice(0, end === undefined ? matched.length : end + 1)
    .reduce<Record<string, string>>(
      (params, {params: levelParams}) => ({...params, ...levelParams}),
      {}
    );
}

/**
 * Get current route params from router. The params are re-derived by
 * matching the current entry of {@link RouterInstance.locationStack} so
 * they stay correct even when the view stack holds resolved views
 * (e.g. React elements) instead of match results. Merges params of all
 * matched levels; deeper levels override shallower ones. Returns
 * `undefined` when the current entry's slot is outside the restored
 * window — its location is unknown to this session, so there is nothing
 * to merge (a path that matches no route still yields `{}`).
 * @group Methods
 * @category Router
 * @param router router instance
 * @returns the merged params object, or `undefined` for out-of-window slots
 */
export function getParams<R extends BaseRoute = BaseRoute>(
  router: RouterInstance<R>
): Record<string, string> | undefined {
  const {index} = getHistoryState(router);
  const location =
    router.locationStack[index - (router as RouterCore<R>).baseIndex];
  if (!location) return undefined;
  return mergeMatchedParams(match(router, location.pathname) ?? []);
}
