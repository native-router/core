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

export type BaseRoute<T = any> = {
  path?: Path;
  children?: BaseRoute<T>[];
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
