import type {Path, MatchResult} from 'path-to-regexp';
import type {History, Path as HPath} from 'history';

export type Location<T = any> = HPath & {state?: T};

export type HistoryState = {
  locationStack: Location[];
  index: number;
  state?: any;
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
};

export type RequiredOf<T, K extends keyof T> = Required<Pick<T, K>> &
  Omit<T, K>;

export type RouterInstance<R extends BaseRoute, V = any> = {
  routes: R[];
  baseUrl: string;
  history: History & {location: WrappedLocation};
  viewStack: V[];
  locationStack: Location[];
  resolveView: ResolveView<R, V>;
  currentGuard<T>(promise: Promise<T>): Promise<T>;
  cancelAll(): void;
  resolving?: Location;
} & RequiredOf<Options<V>, 'baseUrl'>;
