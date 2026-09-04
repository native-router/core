import type {Path, MatchResult} from 'path-to-regexp';
import type {History, Path as HPath} from 'history';
import type {DebugInfo, DebugListener} from './debug';

export type Location<T = any> = HPath & {state?: T};

export type HistoryState = {
  index: number;
  state?: any;
  /**
   * Bounded window(tail entries) of the session location stack,
   * serialized into the history entry so {@link create} can restore it
   * after a refresh. Its length never exceeds `maxStackDepth`.
   * 有界窗口：会话 locationStack 的尾部条目，刷新后据此恢复内存栈。
   */
  locationStack?: Location[];
  /**
   * Absolute stack index of `locationStack[0]`; omitted(or 0) means the
   * window starts at the session root.
   * locationStack[0] 对应的绝对 index，省略时为 0。
   */
  base?: number;
};

export type WrappedLocation = Location<HistoryState>;

/**
 * How a navigation committed, reported to `listen` callbacks as the second
 * argument:
 * - `'push'`: a new entry landed on top of the stack(`navigate`/`commit`)
 * - `'replace'`: the current entry was rewritten(`refresh`/`commitReplace`,
 *   guard redirects, and `listen`'s initial warm-up replace)
 * - `'pop'`: back/forward landing on a cached view(or a lazy re-resolve),
 *   including the rewind landing of a vetoed POP
 *
 * 导航落位方式，作为 `listen` 回调的第二个参数上报：push 新压栈、
 * replace 重写当前条目、pop 回退/前进命中快照（含被拦截 POP 的回摆落位）。
 * @group Types
 * @category Router
 */
export type NavAction = 'push' | 'replace' | 'pop';

export type Awaitable<T> = T | Promise<T>;

/**
 * The [Standard Schema](https://standardschema.dev) interface, version 1 —
 * the common validation interface implemented by zod, valibot and arktype.
 *
 * Inlined type-only from `@standard-schema/spec` so the core keeps zero
 * extra runtime dependencies: any schema exposing `~standard` works.
 * @group Types
 * @category Route
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1;
    /** The vendor name of the schema library. */
    readonly vendor: string;
    /** Validates unknown input values. */
    readonly validate: (
      value: unknown
    ) => Result<Output> | Promise<Result<Output>>;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    /** The typed output value. */
    readonly value: Output;
    /** The issues of the input value. */
    readonly issues?: undefined;
  }

  export interface FailureResult {
    /** The issues of the input value. */
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    /** The issue message. */
    readonly message: string;
    /** The issue path. */
    readonly path?: ReadonlyArray<PropertyKey | PathSegment>;
  }

  export interface PathSegment {
    /** The key of the path segment. */
    readonly key: PropertyKey;
  }
}

/**
 * The plain input object a search string degrades into before schema
 * validation: single-valued keys are strings, keys repeated in the query
 * string are arrays of their values.
 * @group Types
 * @category Route
 */
export type SearchInput = Record<string, string | string[]>;

/**
 * Parsed output type of a {@link StandardSchemaV1 search schema}.
 * @group Types
 * @category Route
 */
export type SearchOutputOf<S> =
  S extends StandardSchemaV1<any, infer Output> ? Output : never;

/** ASCII approximation of path-to-regexp's `ID_Start`. */
type ParamStartChar =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z'
  | '_'
  | '$';

/** ASCII approximation of path-to-regexp's `ID_Continue`. */
type ParamContinueChar =
  ParamStartChar | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

type ParamValueOf<
  Name extends string,
  Mode extends 'param' | 'wildcard'
> = Mode extends 'wildcard' ? {[K in Name]: string[]} : {[K in Name]: string};

/**
 * Scan a segment char by char: `\\x` escapes the next char, `:name`
 * starts a param, `*name` starts a wildcard, anything else is static
 * text.
 */
type SegmentParamsOf<Seg extends string> =
  Seg extends `${infer Char}${infer Rest}`
    ? Char extends '\\'
      ? Rest extends `${string}${infer Tail}`
        ? SegmentParamsOf<Tail>
        : {}
      : Char extends ':' | '*'
        ? Rest extends `${infer First}${infer Rest2}`
          ? First extends ParamStartChar
            ? ParamNameOf<Rest2, First, Char extends '*' ? 'wildcard' : 'param'>
            : {} // Empty/quoted/digit-led name: runtime throws
          : {} // Trailing bare `:` or `*`
        : SegmentParamsOf<Rest>
    : {};

/** Consume the identifier run started by a `ParamStartChar`. */
type ParamNameOf<
  Rest extends string,
  Name extends string,
  Mode extends 'param' | 'wildcard'
> = Rest extends `${infer Char}${infer Tail}`
  ? Char extends ParamContinueChar
    ? ParamNameOf<Tail, `${Name}${Char}`, Mode>
    : Char extends '?' | '(' | ')' | '[' | ']' | '+' | '!' | '*'
      ? {} // `:id?` / `:id(\\d+)` / `:id*` …: runtime parse throws
      : ParamValueOf<Name, Mode> & SegmentParamsOf<Rest>
  : ParamValueOf<Name, Mode>;

/**
 * Params contributed by a single path segment, modeled after the
 * path-to-regexp **8.4.2** string grammar(the version this package
 * locks):
 *
 * - `:name` contributes a required `string` param wherever it appears
 *   in the segment — `:id`, `page-:id`, `:from-:to` all work at
 *   runtime and are modeled;
 * - `*name` contributes a `string[]` wildcard param(the runtime
 *   matcher splits a wildcard value by `/`).
 *
 * Everything else contributes nothing:
 *
 * - the v6-era suffixes `:id?`, `:id+`, `:id*`, `:id(\\d+)` are **not**
 *   runtime syntax in 8.4.2 — the matcher throws a `PathError` when the
 *   path is compiled, so they are deliberately left unmodeled instead
 *   of endorsing a path that crashes;
 * - quoted names(`:"x y"`) and non-ASCII identifier chars are not
 *   modeled(the scanner only knows ASCII identifiers).
 *
 * Note: wildcard params surface as `string[]` at runtime while the
 * router-level types(`Matched.params`,
 * {@link GuardContext.params}) are `Record<string, string>` — the
 * router does not model wildcard params.
 * @group Types
 * @category Route
 */
export type PathParamsOf<Seg extends string> = SegmentParamsOf<Seg>;

/**
 * Extract the params shape of a route path pattern. Splits the pattern
 * into `/`-separated segments and intersects the params of each, e.g.
 * `ExtractPathParams<'/users/:id/files/*rest'>` is
 * `{id: string} & {rest: string[]}`.
 *
 * Within the modeled path-to-regexp 8.4.2 syntax scope(see
 * {@link PathParamsOf}); static segments are ignored and v6-era
 * suffixes(`:id?`, `:id(\\d+)`, …) contribute nothing because the
 * runtime matcher rejects them. Distributes over unions of patterns.
 * @group Types
 * @category Route
 */
export type ExtractPathParams<P extends string> =
  P extends `${infer Head}/${infer Rest}`
    ? PathParamsOf<Head> & ExtractPathParams<Rest>
    : PathParamsOf<P>;

/**
 * Context passed to a route guard({@link BaseRoute.beforeLoad beforeLoad}).
 * `params` are accumulated from the root level down to the level that
 * owns the guard, so a guard only sees params of itself and its parents.
 *
 * Type arguments: `S` types {@link GuardContext.search search}(schema
 * output, or the degraded input without a schema), `P` types
 * {@link GuardContext.params params}, `C` types
 * {@link GuardContext.context context}. All default to what a
 * schema-less, context-less route produces — `search: unknown`,
 * `params: the raw string map`, `context: undefined` — so plain guards
 * keep compiling unchanged; thread a params schema's coerced output
 * through `P`(and the router's context type through `C`) to type what
 * the guard actually receives at runtime.
 */

export type GuardContext<
  R extends BaseRoute = BaseRoute,
  S = unknown,
  P = Record<string, string>,
  C = undefined
> = {
  router: RouterInstance<R>;
  location: Location;
  /**
   * The merged params of this level and its parents: when any level
   * declares a {@link BaseRoute.params params schema}, the merged raw
   * params are parsed through the deepest matching schema before the
   * guard runs; without schemas the raw string map the matcher
   * extracted. The loose default models the raw map; give the third
   * type argument the schema's output(`GuardContext<R, S, {id: number}>`
   * for a `z.coerce.number()` id) — the runtime value is the parse
   * result, which a coercing schema makes anything but
   * `Record<string, string>`.
   */
  params: P;
  /**
   * The search the guard sees: the route's {@link BaseRoute.search search
   * schema} output(parsed and validated before the guard runs), or the
   * degraded {@link SearchInput} when the route declares no schema. The
   * loose default types it `unknown` — narrow it in the guard, or let a
   * typed route table(see `createRoutes` of `@native-router/react`)
   * derive it from the schema.
   */
  search: S;
  /**
   * Aborted when this navigation is superseded by a newer one or
   * cancelled(see {@link RouterInstance.cancelAll cancel}); pass it to
   * the guard's requests(e.g. `fetch(url, {signal})`) so a discarded
   * navigation stops consuming the network.
   */
  signal: AbortSignal;
  /**
   * The router's {@link Options.context instance context} — the value
   * passed as `context` to {@link create}, shared by everything the
   * router resolves(deps, config, i18n handles, ...). It is per
   * instance, so two routers(e.g. one per test, or one per micro-frontend
   * pane) each see their own value where a module singleton would leak
   * across them.
   *
   * The loose default types it `undefined` — what a context-less
   * `create` produces; thread the fourth type argument the value's type
   * (`GuardContext<R, S, P, {api: Api}>`) to type what the guard actually
   * receives at runtime.
   */
  context: C;
};

export type BaseRoute<T = any> = {
  path?: Path;
  children?: BaseRoute<T>[];
  /**
   * Static redirect target. When set, navigating to this route is
   * redirected to the target path before the view resolves.
   */
  redirect?: string;
  /**
   * Optional Standard Schema(zod/valibot/arktype, ...) validator of the
   * route search. Frameworks parse `location.search` with it at resolve
   * time(see `parseSearch`) and inject the parsed output into their data
   * contexts; a validation failure fails the resolve like any other
   * navigation error.
   */
  search?: StandardSchemaV1;
  /**
   * The search keys this level's resolution consumes — the opt-in that
   * keeps irrelevant search changes from re-resolving a route.
   *
   * A navigation to the same pathname normally re-runs the whole chain
   * (every level's `beforeLoad`, `data`/`resolveView` and lazy
   * `component` imports) however small the search change is. Declaring
   * `searchDeps` narrows that: when every level of the matched chain
   * declares `searchDeps` and the declared projection of the search is
   * unchanged between the current entry and the target, `navigate`(and
   * framework setters built on {@link reusableEntry}) re-serve the
   * current view snapshot as the new entry — zero guards, zero loaders,
   * zero imports — exactly like a POP hitting the `viewStack`.
   *
   * Two forms:
   * - `string[]`: the consumed keys, picked from the degraded
   *   {@link SearchInput}(strings; repeated keys as arrays). `[]` means
   *   "this level ignores the search entirely" — any search change is
   *   irrelevant to it.
   * - `(search) => unknown`: derives the projection yourself; the
   *   returned value is compared after `JSON.stringify`, so return
   *   primitives or stable-shaped values(arrays of the declared keys are
   *   the norm, object literals work while key order stays fixed).
   *
   * The contract cuts both ways — everything the level's resolution
   * reads from the search must be covered:
   * - One undeclared level in the chain re-resolves the whole chain on
   *   every navigation, exactly as before(undeclared is today's
   *   behavior, byte for byte).
   * - Keys the {@link BaseRoute.search search schema} validates strictly
   *   belong in `searchDeps` too: a skipped navigation runs no schema,
   *   so an invalid value of an undeclared key lands in the URL
   *   unchecked(setters like `useSetSearch` validate the whole value
   *   before navigating regardless).
   * - A skipped navigation runs no `beforeLoad`: a guard that reads
   *   search keys must see them listed, or it will not re-run when they
   *   change.
   *
   * What is never compared: `hash` and `state`(they are not resolve
   * inputs — on a fully declared chain a hash-only navigation is served
   * from the snapshot too), and the retained view keeps its
   * resolve-time context — framework data/`ctx` reflect the entry the
   * view was resolved for, so read live search through the framework's
   * search hooks rather than the matched context. POP replay,
   * {@link initHistoryStack} warm-up, `refresh` and `invalidate` are
   * untouched: a dropped snapshot(`invalidate`) disables the fast path
   * until the next real resolve.
   */
  searchDeps?: string[] | ((search: SearchInput) => unknown);
  /**
   * Optional Standard Schema validator of the merged path params this
   * level and its parents contribute(see `mergeMatchedParams`). The core
   * runs it in {@link resolveEntry} after matching and before the level's
   * `beforeLoad`, so guards and loaders see coerced params(e.g. `:id`
   * as a number) instead of raw strings; a validation failure fails the
   * resolve like any other navigation error(via `ParamsError`). A level
   * with a {@link BaseRoute.redirect redirect} skips the schema — the
   * guard never runs there, so the schema would have no consumer.
   *
   * Omit it and the params stay the raw `Record<string, string>` the
   * matcher extracted — behavior is unchanged.
   */
  params?: StandardSchemaV1;
  /**
   * Route-local context: a plain object merged OVER the router's
   * {@link Options.context instance context} for this level and every
   * deeper level of its chain(route wins on key conflicts). `beforeLoad`
   * guards receive the merge accumulated through their own level as
   * their {@link GuardContext.context ctx.context}, and `resolveView`
   * implementations receive the merge over the whole matched chain as
   * their {@link ResolveViewContext.context ctx.context} — frameworks
   * forward the per-level prefix to their data loaders.
   *
   * Levels without `context`(or with `null`/`undefined`) contribute
   * nothing, so tables that never declare route contexts keep the exact
   * instance-context value they always had — the field is purely
   * additive. The merge is a shallow spread at resolve time: it is not
   * reactive, and mutating the declared object later does not re-resolve
   * anything.
   */
  context?: unknown;
  /**
   * Route guard invoked before the view resolves. Return a path string
   * to redirect, or nothing(`undefined`) to continue. The guard's
   * {@link GuardContext context} carries the level's parsed
   * {@link GuardContext.search search}(schema output, or the degraded
   * input without a schema); an invalid search fails the resolution at
   * this phase like any other navigation error.
   */
  beforeLoad?(ctx: GuardContext<BaseRoute<T>>): Awaitable<string | void>;
} & Omit<T, 'path' | 'children'>;

export type Matched<R extends BaseRoute = BaseRoute> = {route: R} & MatchResult<
  Record<string, string>
>;

export type ResolveViewContext<R extends BaseRoute, C = undefined> = {
  router: RouterInstance<R>;
  location: Location;
  /**
   * The navigation chain's abort signal: aborted when this navigation is
   * superseded by a newer one or cancelled. Frameworks forward it into
   * their data contexts so loaders can abort their requests.
   */
  signal: AbortSignal;
  /**
   * The router's {@link Options.context instance context} — the value
   * passed as `context` to {@link create}. Frameworks forward it into
   * their data contexts alongside `signal`(see `@native-router/react`'s
   * `data` loaders); the loose default `undefined` is what a context-less
   * `create` produces — thread the router's context type through the
   * second type argument to type it.
   */
  context: C;
};
export type ResolveView<R extends BaseRoute, V> = (
  matched: Matched<R>[],
  ctx: ResolveViewContext<R>
) => Promise<V>;

export type Options<V, C = undefined> = {
  baseUrl?: string;
  currentView?: V;
  /**
   * The router's instance context: a synchronous value baked in at
   * {@link create} time, shared by everything this router resolves.
   * Guards receive it as {@link GuardContext.context ctx.context},
   * `resolveView` implementations as {@link ResolveViewContext.context
   * ctx.context} — the injection point for per-instance dependencies
   * (an API client, config, i18n handles, test fixtures) that a module
   * singleton cannot isolate: two routers(e.g. one per test, or one per
   * micro-frontend pane) each carry their own value.
   *
   * The value's type is inferred from this option and flows into the
   * returned {@link RouterInstance RouterInstance<R, V, C>}'s `context`
   * member; omit it and the context stays `undefined` — existing routers
   * keep their exact types and behavior.
   *
   * One value per instance, read synchronously: it is not a reactive
   * store, does not re-resolve anything on change, and takes no part in
   * the viewStack snapshot keys(instance-level state is naturally
   * isolated between routers).
   */
  context?: C;
  errorHandler?(e: Error): V | Promise<V>;
  onLoadingChange?(status?: 'pending' | 'resolved' | 'rejected'): void;
  /**
   * Max number of {@link preload} resolutions in flight at once,
   * default 4. Once exceeded, the oldest still-running preload is
   * aborted FIFO — its guards and loaders observe the abort through
   * their `ctx.signal`, its cache slot is dropped, and its failure is
   * swallowed as background noise. A preload consumed by a committing
   * navigation (`commit`/`commitReplace`) is detached from the bound
   * and never aborted by it. A single hover-prefetch never hits the
   * bound; it exists so sweeping a list of prefetch links cannot
   * accumulate unbounded requests.
   *
   * 同时在飞的 {@link preload} 解析数量上限，默认 4。超出后最旧的
   * 预取按 FIFO 被 abort——守卫与加载器经 `ctx.signal` 感知中止，缓存
   * 槽位随之丢弃，失败按后台语义吞掉。被导航消费（`commit`/
   * `commitReplace`）的预取脱离该上限约束、绝不会被它中止。单个
   * hover 预取不会触达上限；上限存在的意义是扫过一列预取链接时
   * 请求不会无限累积。
   */
  preloadConcurrency?: number;
  /**
   * Max number of locations serialized into the history state window,
   * see {@link HistoryState.locationStack}.
   *
   * Defaults to 100, at or above the per-tab history caps of mainstream
   * browsers(Chromium/Gecko ~50, WebKit ~100). The window boundary can
   * therefore only appear after the browser itself has already evicted
   * entries: anything outside the window is unreachable to the user, so
   * a bounded window is observationally equivalent to full serialization.
   *
   * 序列化进 history state 的栈窗口上限，默认 100，不低于主流浏览器
   * 单标签历史上限（Chromium/Gecko 约 50、WebKit 约 100）。窗口边界只会在
   * 浏览器自身裁剪历史之后才可能出现，用户不可达窗口外条目，行为与
   * 全量序列化无可观察差异。
   */
  maxStackDepth?: number;
};

export type RequiredOf<T, K extends keyof T> = Required<Pick<T, K>> &
  Omit<T, K>;

/**
 * @group Types
 * @category Router
 */
export type RouterInstance<R extends BaseRoute, V = any, C = any> = {
  routes: R[];
  baseUrl: string;
  history: History & {location: WrappedLocation};
  viewStack: V[];
  /**
   * In-memory location stack of the current session. On creation it is
   * restored from the bounded window serialized in the history state,
   * so in-window back/forward survive a refresh.
   * 会话内存栈；create 时从 history state 的有界窗口恢复。
   */
  locationStack: Location[];
  resolveView: ResolveView<R, V>;
  currentGuard<T>(promise: Promise<T>, discarded: () => Error): Promise<T>;
  cancelAll(): void;
  resolving?: Location;
  /**
   * Subscribe to navigation lifecycle debug events(`nav-start`/
   * `nav-commit`/`nav-cancel`/`nav-supersede`/`nav-error`, see
   * {@link DebugEvent}). Attached by {@link create}; purely
   * observational and free when unused. The standalone
   * {@link onDebug} function does the same for any router object.
   */
  onDebug?: (listener: DebugListener) => () => void;
  /**
   * Take an observability snapshot(current location, session window
   * depth/base, snapshot count, the in-flight chain — see
   * {@link DebugInfo}). Attached by {@link create}; the standalone
   * {@link getDebugInfo} function does the same for any router object.
   */
  getDebugInfo?: () => DebugInfo;
  /**
   * The router's {@link Options.context instance context} — the value
   * passed as `context` to {@link create}, `undefined` for context-less
   * routers. Guards and `resolveView` implementations receive it as
   * their ctx's `context`; per instance, so two routers never share it.
   * Declared here(instead of through `RequiredOf`) because `Required`
   * strips the `undefined` unit an optional `context?: undefined` would
   * contribute — and `undefined` minus `undefined` is `never`.
   */
  context: C;
} & RequiredOf<Options<V, C>, 'baseUrl' | 'maxStackDepth'>;
