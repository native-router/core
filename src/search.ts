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

/**
 * Output type of {@link writeSchema}: the read schema's output with the
 * write-optional keys made optional — a key is strippable from the
 * written URL when it has a default(the validated value equal to it is
 * omitted) or when it is already optional in the read output(absent
 * stays absent). Keys that are neither stay required.
 * @group Types
 * @category Route
 */
export type WriteSearchOutputOf<O, D> = Simplify<
  {
    [K in keyof O as K extends keyof D
      ? never
      : {} extends Pick<O, K & keyof O>
        ? never
        : K]: O[K];
  } & {
    [K in keyof O as K extends keyof D
      ? K
      : {} extends Pick<O, K & keyof O>
        ? K
        : never]?: O[K];
  }
>;

/**
 * Build the write-side twin of a read search schema, for URL writes that
 * keep the query clean: the next value is validated by the SAME read
 * schema(coercion and defaults included), then every key whose validated
 * value equals its default(`Object.is`) is stripped, so defaults never
 * pollute the URL — reading the stripped URL back through the read
 * schema restores the exact same value.
 *
 * The typical pairing is `useSetSearch(writeSchema(readSchema,
 * {offset: 0, limit: 10}))` of `@native-router/react`: writes serialize
 * only what differs from the defaults, while reads keep coercing and
 * defaulting through the single read contract. Hand-writing the second
 * schema is no longer needed.
 *
 * Sync in, sync out — an async read schema yields an async write schema
 * (the projection rides the promise), and a rejected read result passes
 * through untouched.
 *
 * @group Methods
 * @category Route
 * @param schema the read-side search schema
 * @param defaults the default values whose equal outputs are omitted
 * @returns the write projection schema
 */
export function writeSchema<O, D extends Partial<O>>(
  schema: StandardSchemaV1<unknown, O>,
  defaults: D
): StandardSchemaV1<unknown, WriteSearchOutputOf<O, D>> {
  return {
    '~standard': {
      version: 1,
      vendor: '@native-router/core',
      validate: (input) => {
        const result = schema['~standard'].validate(input);
        const project = (
          result: StandardSchemaV1.Result<unknown>
        ): StandardSchemaV1.Result<WriteSearchOutputOf<O, D>> =>
          result.issues
            ? result
            : {
                // The schema's declared output; see parseSearch for the
                // cast rationale.
                value: omitDefaults<O, D>(result.value as O, defaults)
              };
        return isThenable(result) ? result.then(project) : project(result);
      }
    }
  };
}

/** Spread-free flattening of {@link WriteSearchOutputOf}'s two halves. */
type Simplify<T> = {[K in keyof T]: T[K]} & {};

function omitDefaults<O, D extends Partial<O>>(
  value: O,
  defaults: D
): WriteSearchOutputOf<O, D> {
  const out: Record<string, unknown> = {...(value as Record<string, unknown>)};
  const table = defaults as Record<string, unknown>;
  // Undefined-valued keys never serialize into a query; drop them so the
  // projection matches its optional-keyed type.
  for (const key of Object.keys(out)) {
    if (out[key] === undefined || Object.is(out[key], table[key]))
      delete out[key];
  }
  return out as WriteSearchOutputOf<O, D>;
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
