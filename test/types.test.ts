/**
 * Compile-time contracts of the exported types. Vitest runs this file as
 * a passing no-op(`expectTypeOf` is erased at runtime); the assertions
 * are enforced by `npm run typecheck`(`tsc -p tsconfig.test.json`).
 */
import {describe, it, expectTypeOf} from 'vitest';
import type {BaseRoute, GuardContext, StandardSchemaV1} from '../src/index';

describe('GuardContext', () => {
  it('should default params to the raw string map', () => {
    expectTypeOf<GuardContext['params']>().toEqualTypeOf<
      Record<string, string>
    >();
    // The two-argument instantiation framework layers already use
    // (router, search output) keeps that meaning: params stay the
    // default raw map.
    expectTypeOf<
      GuardContext<BaseRoute, {q: string}>['params']
    >().toEqualTypeOf<Record<string, string>>();
  });

  it('should type params as the schema output through the third argument', () => {
    expectTypeOf<
      GuardContext<BaseRoute, unknown, {id: number}>['params']
    >().toEqualTypeOf<{id: number}>();
  });

  it('should accept a coerced params value only through the output generic', () => {
    const coerced = {id: 1};
    // The reviewer's TS2322: a coercing schema's output is not
    // assignable to the loose default's `Record<string, string>`.
    // @ts-expect-error number is not string
    const loose: GuardContext['params'] = coerced;
    // Expressed through the third type argument it fits.
    const typed: GuardContext<BaseRoute, unknown, {id: number}>['params'] =
      coerced;
    expectTypeOf(loose).toEqualTypeOf<Record<string, string>>();
    expectTypeOf(typed).toEqualTypeOf<{id: number}>();
  });

  it('should type a schema-declaring guard through an annotated context', () => {
    // The runtime hands the guard the schema's coerced output; the
    // output generic is the only way the static type says so.
    const idSchema: StandardSchemaV1<unknown, {id: number}> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => ({
          value: {id: Number((value as {id: string}).id)}
        })
      }
    };
    const guard = (ctx: GuardContext<BaseRoute, unknown, {id: number}>) => {
      const {id} = ctx.params;
      expectTypeOf(id).toBeNumber();
      return id > 0 ? undefined : '/users';
    };
    expectTypeOf(idSchema).toExtend<StandardSchemaV1>();
    expectTypeOf(guard).toBeFunction();
  });
});

describe('instance context', () => {
  it('should default the ctx context to undefined', () => {
    expectTypeOf<GuardContext['context']>().toEqualTypeOf<undefined>();
    expectTypeOf<
      GuardContext<BaseRoute, {q: string}>['context']
    >().toEqualTypeOf<undefined>();
  });

  it('should type the ctx context through the fourth argument', () => {
    expectTypeOf<
      GuardContext<
        BaseRoute,
        unknown,
        Record<string, string>,
        {api: string}
      >['context']
    >().toEqualTypeOf<{api: string}>();
  });

  it('should infer the instance context type from the create option', async () => {
    const {create} = await import('../src/router');
    const history = {location: {pathname: '/'}} as never;

    const contextual = create(
      {path: '/'},
      history,
      () => Promise.resolve(null),
      {context: {api: 'x'}}
    );
    expectTypeOf(contextual.context).toEqualTypeOf<{api: string}>();

    // No context option: the member stays exactly `undefined` — the
    // pre-existing types are unchanged for old call sites.
    const plain = create({path: '/'}, history, () => Promise.resolve(null));
    expectTypeOf(plain.context).toEqualTypeOf<undefined>();
    const baseUrlOnly = create(
      {path: '/'},
      history,
      () => Promise.resolve(null),
      {
        baseUrl: '/app'
      }
    );
    expectTypeOf(baseUrlOnly.context).toEqualTypeOf<undefined>();
  });
});

describe('WriteSearchOutputOf', () => {
  it('should make defaulted and read-optional keys optional, keep the rest required', async () => {
    const {writeSchema} = await import('../src/search');
    type HomeSearch = {tag?: string; offset: number; limit: number};
    const read: StandardSchemaV1<unknown, HomeSearch> = {
      '~standard': {version: 1, vendor: 'test', validate: (v) => ({value: v as HomeSearch})}
    };
    const write = writeSchema(read, {offset: 0, limit: 10});

    // All three keys strippable: `tag` read-optional, `offset`/`limit`
    // defaulted — the painless Home write contract.
    expectTypeOf(write).toExtend<
      StandardSchemaV1<unknown, {tag?: string; offset?: number; limit?: number}>
    >();

    type Only = {page: number; size: number; q?: string};
    const readList: StandardSchemaV1<unknown, Only> = {
      '~standard': {version: 1, vendor: 'test', validate: (v) => ({value: v as Only})}
    };
    // `page` has no default and is required → stays required; `size`
    // defaulted and `q` read-optional → optional.
    expectTypeOf(writeSchema(readList, {size: 10})).toExtend<
      StandardSchemaV1<unknown, {page: number; size?: number; q?: string}>
    >();
  });
});
