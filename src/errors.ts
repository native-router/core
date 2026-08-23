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

function formatIssuePath(path: StandardSchemaV1.Issue['path']) {
  if (!path?.length) return '';
  const keys = path.map((segment) =>
    typeof segment === 'object' ? String(segment.key) : String(segment)
  );
  return `${keys.join('.')}: `;
}
