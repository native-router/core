/* eslint-disable max-classes-per-file */
import type {StandardSchemaV1} from './types';

export class NativeRouterError extends Error {}

export class NotFoundError extends NativeRouterError {
  constructor(pathname: string) {
    super(`Can't find the path: ${pathname}`);
  }
}

export class RedirectLoopError extends NativeRouterError {
  constructor(target?: string) {
    super(
      `Redirect loop detected${
        target ? ` after following redirects to: ${target}` : ''
      }`
    );
  }
}

/**
 * Rejected when a navigation dies by replacement instead of failure: a
 * newer navigation superseded it, or `cancel()` discarded it (a history
 * POP cancels the in-flight chain the same way). The chain's guards and
 * loaders were aborted through their `signal`, and its result — even a
 * late-settling one — is dropped. Awaiters observe this rejection so a
 * discarded navigation never hangs its caller; a vetoed navigation
 * (blocker) instead resolves normally, since a veto is a user decision,
 * not a failure.
 */
export class NavigationCancelledError extends NativeRouterError {
  /** The discarded navigation's target, in committed path form. */
  readonly to: string;

  constructor(to: string) {
    super(`Navigation to "${to}" was cancelled or superseded`);
    this.to = to;
  }
}

/**
 * Thrown when a route {@link BaseRoute.search search schema} rejects the
 * location search. Issues are formatted as `path: message` pairs joined
 * with `; `, e.g.
 * `Invalid search params "?page=abc": page: Expected a positive integer`.
 */
export class SearchError extends NativeRouterError {
  /** The raw search string that failed validation. */
  readonly search: string;

  /** The issues reported by the schema. */
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;

  constructor(search: string, issues: ReadonlyArray<StandardSchemaV1.Issue>) {
    super(
      `Invalid search params "${search}": ${issues
        .map(({message, path}) => `${formatIssuePath(path)}${message}`)
        .join('; ')}`
    );
    this.search = search;
    this.issues = issues;
  }
}

/**
 * Thrown when a route {@link BaseRoute.params params schema} rejects the
 * merged path params. Issues are formatted like {@link SearchError}'s —
 * `path: message` pairs joined with `; `, e.g.
 * `Invalid path params "/users/abc": id: expected a number`.
 */
export class ParamsError extends NativeRouterError {
  /** The raw params object that failed validation. */
  readonly params: Record<string, string>;

  /** The issues reported by the schema. */
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;

  constructor(
    params: Record<string, string>,
    issues: ReadonlyArray<StandardSchemaV1.Issue>
  ) {
    super(
      `Invalid path params "${JSON.stringify(params)}": ${issues
        .map(({message, path}) => `${formatIssuePath(path)}${message}`)
        .join('; ')}`
    );
    this.params = params;
    this.issues = issues;
  }
}

function formatIssuePath(path: StandardSchemaV1.Issue['path']) {
  if (!path?.length) return '';
  const keys = path.map((segment) =>
    typeof segment === 'object' ? String(segment.key) : String(segment)
  );
  return `${keys.join('.')}: `;
}
