import type {Path, MatchResult} from 'path-to-regexp';
import type {History, Path as HPath} from 'history';

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

/* eslint-disable no-use-before-define -- namespace members reference siblings defined below, verbatim from @standard-schema/spec */
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
/* eslint-enable no-use-before-define */

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
            ? // eslint-disable-next-line no-use-before-define -- mutually recursive with the name scanner
              ParamNameOf<Rest2, First, Char extends '*' ? 'wildcard' : 'param'>
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
 */
// eslint-disable-next-line no-use-before-define -- generic default referencing a type declared below
export type GuardContext<R extends BaseRoute = BaseRoute> = {
  // eslint-disable-next-line no-use-before-define
  router: RouterInstance<R>;
  location: Location;
  params: Record<string, string>;
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
   * Route guard invoked before the view resolves. Return a path string
   * to redirect, or nothing(`undefined`) to continue.
   */
  beforeLoad?(ctx: GuardContext<BaseRoute<T>>): Awaitable<string | void>;
} & Omit<T, 'path' | 'children'>;

export type Matched<R extends BaseRoute = BaseRoute> = {route: R} & MatchResult<
  Record<string, string>
>;

export type ResolveViewContext<R extends BaseRoute> = {
  // eslint-disable-next-line no-use-before-define
  router: RouterInstance<R>;
  location: Location;
};
export type ResolveView<R extends BaseRoute, V> = (
  matched: Matched<R>[],
  ctx: ResolveViewContext<R>
) => Promise<V>;

export type Options<V> = {
  baseUrl?: string;
  currentView?: V;
  errorHandler?(e: Error): V | Promise<V>;
  onLoadingChange?(status?: 'pending' | 'resolved' | 'rejected'): void;
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

export type RouterInstance<R extends BaseRoute, V = any> = {
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
  currentGuard<T>(promise: Promise<T>): Promise<T>;
  cancelAll(): void;
  resolving?: Location;
} & RequiredOf<Options<V>, 'baseUrl' | 'maxStackDepth'>;
