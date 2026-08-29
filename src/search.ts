import {ParamsError, SearchError} from './errors';
import type {SearchInput, SearchOutputOf, StandardSchemaV1} from './types';

/**
 * Parse a raw search string(e.g. `?page=2&tag=a&tag=b`) into the plain
 * input object consumed by {@link StandardSchemaV1 search schemas}:
 * single-valued keys are strings, keys repeated in the query string are
 * arrays of their values. An empty search is `{}`.
 *
 * This is also the degraded shape every search API falls back to when no
 * schema is given.
 * @group Methods
 * @category Route
 * @param search the raw `location.search` string, with or without `?`
 * @returns the input object for schema validation
 */
export function parseSearchInput(search: string): SearchInput {
  const input: SearchInput = {};
  // eslint-disable-next-line compat/compat -- URLSearchParams support is the app's polyfill concern, not bundled
  new URLSearchParams(search).forEach((value, key) => {
    const prev = input[key];
    if (prev === undefined) {
      input[key] = value;
    } else if (Array.isArray(prev)) {
      prev.push(value);
    } else {
      input[key] = [prev, value];
    }
  });
  return input;
}

/**
 * Validate a search string with a {@link StandardSchemaV1} schema — any
 * zod/valibot/arktype schema works, no hard dependency. The string is
 * first degraded via {@link parseSearchInput}, then parsed by the schema,
 * so schemas can coerce(`'2'` → `2`) and normalize along the way.
 *
 * Async schemas(`validate` returning a promise) are awaited.
 *
 * @group Methods
 * @category Route
 * @param schema the search schema
 * @param search the raw `location.search` string
 * @returns the parsed(and possibly coerced) output of the schema
 * @throws {SearchError} when the schema reports issues
 */
export async function parseSearch<S extends StandardSchemaV1>(
  schema: S,
  search: string
): Promise<SearchOutputOf<S>> {
  const result = await schema['~standard'].validate(parseSearchInput(search));
  if (result.issues) throw new SearchError(search, result.issues);
  // The schema's declared output; the loose `StandardSchemaV1` default
  // degrades to `unknown`.
  return result.value as SearchOutputOf<S>;
}

/**
 * Synchronous flavor of {@link parseSearch}, for render-time reads(see
 * `useSearch` of `@native-router/react`) and route guards.
 *
 * @group Methods
 * @category Route
 * @param schema the search schema — must validate synchronously
 * @param search the raw `location.search` string
 * @returns the parsed(and possibly coerced) output of the schema
 * @throws {SearchError} when the schema reports issues
 * @throws when the schema validates asynchronously; use {@link parseSearch}
 * for async schemas instead
 */
export function parseSearchSync<S extends StandardSchemaV1>(
  schema: S,
  search: string
): SearchOutputOf<S> {
  const result = schema['~standard'].validate(parseSearchInput(search));
  if (isThenable(result)) {
    throw new Error(
      'The search schema validates asynchronously; parse it during resolve ' +
        '(parseSearch) instead of synchronously'
    );
  }
  if (result.issues) throw new SearchError(search, result.issues);
  // See parseSearch for the cast rationale.
  return result.value as SearchOutputOf<S>;
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === 'function';
}

/**
 * Validate the merged path params of a route level with a
 * {@link StandardSchemaV1} schema — any zod/valibot/arktype schema
 * works, no hard dependency. Params arrive as the plain string map the
 * matcher extracted(see `mergeMatchedParams`), so schemas can coerce
 * (`'7'` → `7`) and normalize along the way.
 *
 * Async schemas(`validate` returning a promise) are awaited.
 *
 * @group Methods
 * @category Route
 * @param schema the params schema
 * @param params the merged raw params of the level
 * @returns the parsed(and possibly coerced) output of the schema
 * @throws {ParamsError} when the schema reports issues
 */
export async function parseParams<S extends StandardSchemaV1>(
  schema: S,
  params: Record<string, string>
): Promise<SearchOutputOf<S>> {
  const result = await schema['~standard'].validate(params);
  if (result.issues) throw new ParamsError(params, result.issues);
  // The schema's declared output; the loose `StandardSchemaV1` default
  // degrades to `unknown`.
  return result.value as SearchOutputOf<S>;
}

/**
 * Synchronous flavor of {@link parseParams}, for render-time reads and
 * custom `resolveView` implementations.
 *
 * @group Methods
 * @category Route
 * @param schema the params schema — must validate synchronously
 * @param params the merged raw params of the level
 * @returns the parsed(and possibly coerced) output of the schema
 * @throws {ParamsError} when the schema reports issues
 * @throws when the schema validates asynchronously; use {@link parseParams}
 * for async schemas instead
 */
export function parseParamsSync<S extends StandardSchemaV1>(
  schema: S,
  params: Record<string, string>
): SearchOutputOf<S> {
  const result = schema['~standard'].validate(params);
  if (isThenable(result)) {
    throw new Error(
      'The params schema validates asynchronously; parse it during resolve ' +
        '(parseParams) instead of synchronously'
    );
  }
  if (result.issues) throw new ParamsError(params, result.issues);
  // See parseParams for the cast rationale.
  return result.value as SearchOutputOf<S>;
}
