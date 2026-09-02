[![npm](https://img.shields.io/npm/v/@native-router/core.svg)](https://www.npmjs.com/package/@native-router/core)
[![Build Status](https://github.com/native-router/core/actions/workflows/ci.yml/badge.svg)](https://github.com/native-router/core/actions)
[![Coverage](https://img.shields.io/codecov/c/github/native-router/core.svg)](https://codecov.io/gh/native-router/core)
[![install size](https://packagephobia.now.sh/badge?p=@native-router/core)](https://packagephobia.now.sh/result?p=@native-router/core)

# Native Router Core

> Framework-agnostic routing core built on [history](https://github.com/remix-run/history) and [path-to-regexp](https://github.com/pillarjs/path-to-regexp): cancelable async navigation, an in-memory view stack and route guards.

English | [简体中文](./README-zh_CN.md)

## Highlights

### Back with zero requests

Every committed navigation stores its resolved view in the router's in-memory `viewStack`. POP navigations land on the cached view through `listen` — nothing is re-matched or re-resolved.

```ts
import {create, listen} from '@native-router/core';
import {createBrowserHistory} from 'history';

const router = create(routes, createBrowserHistory(), resolveView);

const unlisten = listen(router, (view, action) => {
  // Back/forward lands here instantly with the cached view
  // action: 'push' | 'replace' | 'pop' — how this navigation committed
  mount(view, action);
});
```

`viewStack` is the SPA-navigation counterpart of the browser's [bfcache](https://web.dev/articles/bfcache). The browser snapshots whole documents so cross-document back/forward restores instantly; the router snapshots resolved views so same-document back/forward (`pushState`/POP) does too. The two layers are complementary and never overlap: a same-document navigation never enters the bfcache, and a bfcache restore does not fire `popstate`. Together with your data layer they stack as **bfcache > viewStack > queryCache**, outermost first — any restore short-circuits every inner layer with zero requests, so freshness is compensated at the edges (e.g. refetch-on-focus in the query layer).

Snapshots can outlive their validity — after a logout or an account switch, the previous account's resolved views are exactly what a back POP must not restore. `invalidate(router)` drops every snapshot at once: the currently rendered view is untouched (no re-resolve, no re-render), and the next back/forward re-runs the guards and loaders of the landed entry through the same lazy path as out-of-window entries.

```ts
import {invalidate} from '@native-router/core';

// After the session identity changed: keep rendering the current view,
// but never restore a snapshot of the previous account on back/forward.
invalidate(router);
```

### Survives a refresh

The session stack is serialized into `history.state` as a bounded tail window (`maxStackDepth`, default 100) and restored on `create`. Warm the window once after a refresh with `initHistoryStack`, and every in-window back/forward renders from cache with zero requests. Entries outside the window fall back to a single lazy re-resolve.

```ts
const router = create(routes, createBrowserHistory(), resolveView);
// After a refresh the stack was restored from the history.state window;
// re-resolve every reachable entry so in-window back/forward are zero-request
await initHistoryStack(router);
```

### Guard-aware resolution for prefetching

`resolveEntry` runs the route guards (`redirect`/`beforeLoad`) and returns the terminal location together with its view task, so a link can prefetch exactly what a click would commit.

```ts
import {resolveEntry, commit, toLocation} from '@native-router/core';

const entry = await resolveEntry(router, toLocation(router, '/users/1'));
// entry.location — the terminal location, guards applied
// entry.task    — the view task of the terminal target
const view = await entry.task; // prefetch / preview
commit(router, entry.task, entry.location); // commit like a click
```

## Features

- Framework-agnostic: bring your own `resolveView`, the view type (`V`) is yours — a string, a vdom, anything
- Route matching via path-to-regexp: specificity ranking (static > dynamic > splat segments, declaration order breaks ties), layout routes without `path`, index/fallback children with `path: ''`, strict trailing slashes, case-sensitive, nested params merged deep over shallow
- Route guards: static `redirect` and async `beforeLoad` on every route level, run shallow → deep; more than 10 chained redirects reject with `RedirectLoopError`
- Cancelable async navigation: a new resolve supersedes the in-flight one (`currentGuard`); `cancel()` aborts it; a history POP cancels it too. A superseded or cancelled `navigate()` promise **never settles** — don't `await` a navigation that might be superseded. Superseding or cancelling also aborts the chain's `AbortSignal`: guards (`beforeLoad` ctx) and view loaders (`ResolveViewContext`) receive it as `ctx.signal`, so their in-flight requests stop instead of only having results dropped; `preload` resolutions are shared and therefore never aborted
- Navigation blockers: `setBlocker(router, fn)` registers a synchronous `(to, from) => boolean` veto over path strings, asked at the head of every `navigate`/`commit`/`commitReplace` and before a history POP lands; a vetoed navigation never starts and its promise resolves immediately (a veto is not an error — unlike a cancelled navigation, whose promise never settles), a vetoed POP is rewound with a counter-`go()` that leaves any in-flight navigation running — the classic unsaved-changes guard. `refresh` and guard redirects are never blocked
- Navigation API: `navigate`, `refresh`, `go`/`forward`/`back`, `commit`/`commitReplace`, `createHref`, `getParams`, `match`, `toLocation`, `resolve`, `resolveTo`
- `invalidate(router)`: drop the session view snapshots in one call — the current view stays rendered (no re-resolve, no re-render) and the next back/forward re-resolves through the guards; the typical call site is right after a logout/account switch, so a POP cannot render the previous account's data or bypass guards that already ran
- Search validation via [Standard Schema](https://standardschema.dev): a `search` schema on any route level (zod/valibot/arktype, no hard dependency), parsed with `parseSearch`/`parseSearchSync`; failures throw `SearchError`
- Fine-grained search invalidation via `searchDeps`: declare on each level the search keys its resolution consumes (`[]` = none, a function derives the projection) and a same-path navigation that leaves every declared projection unchanged re-serves the current view snapshot — zero guards, zero loaders, zero lazy imports, exactly like a POP hitting the `viewStack`; undeclared levels keep the resolve-on-every-navigation behavior byte for byte, and `reusableEntry` exports the check for framework setters
- `preload(router, to, {ttl})`: resolve a target through the guards ahead of time, sharing one task across concurrent callers (in-flight dedup) with a TTL, default 30s; consumed entries are dropped on commit
- `errorHandler` hook turns resolve failures into fallback views
- Errors: `NativeRouterError`, `NotFoundError`, `RedirectLoopError`, `SearchError`
- Tree-shakable: `sideEffects: false`

## Matching semantics

- Every matching chain is collected and the **most specific one wins**: per path segment, static text outranks a dynamic `:param`, which outranks a splat `*wildcard`, and every segment adds to the chain's score — so longer chains (more of the URL pinned down) outrank shorter ones. Equally specific chains fall back to **declaration order**. A parent whose prefix matched but whose children all failed never hides later siblings — e.g. `[{path: '/a', children: [{path: '/b'}]}, {path: '/*rest'}]` serves `/a/q` from the wildcard.
- A route **without `path`** is a layout: it matches the empty prefix and its children are matched against the full remaining path.
- A leaf child with **`path: ''`** matches whatever is left under its parent. Declared after its concrete siblings it serves as the parent's index route (and as the fallback for paths unmatched under the parent).
- **Trailing slashes are significant**: `/users/` does not match `/users`.
- Matching is **case-sensitive**.
- Params of nested levels are merged **deep over shallow** (`mergeMatchedParams`): for `/:id` + `/posts/:id`, the deeper `id` wins.

## Search validation

Declare a `search` validator on a route level and parse `location.search` with it in your `resolveView`. Any [Standard Schema](https://standardschema.dev) validator works — zod, valibot and arktype all implement the interface — so the core keeps zero extra runtime dependencies.

```ts
import {create, parseSearch} from '@native-router/core';
import {z} from 'zod';

const listSearch = z.object({page: z.coerce.number().default(1)});

const router = create(
  {path: '', children: [{path: '/list', search: listSearch}]},
  createBrowserHistory(),
  // Your resolveView consumes route.search itself: parse the location
  // search, then resolve the view from the parsed output
  async (matched, {location}) =>
    renderList(await parseSearch(matched.at(-1)!.route.search!, location.search))
);
```

- `parseSearchInput(search)` degrades a query string into a plain object — single-valued keys are strings, keys repeated in the query string are arrays — which is also the input every schema validates
- `parseSearch(schema, search)` resolves the schema output (async validators are awaited); `parseSearchSync` is the render-time flavor and rejects async validators with a clear error
- Guards: `beforeLoad` receives the level's parsed search as `ctx.search` — the schema output (parsed with `parseSearch`, so async validators work), or the degraded input on schema-less levels; an invalid search fails the resolution through the `errorHandler` channel like a data-phase search error
- A rejected validation throws `SearchError` (a `NativeRouterError`) carrying the raw `search` and the reported `issues` — route it through your `errorHandler` like any other resolve failure

### Writing search without dirtying the URL

Read schemas coerce and default, so writing their output straight back would put the defaults into the query (`?offset=0&limit=10` on every link). `writeSchema(schema, defaults)` derives the write-side twin from the read schema: the value is validated by the same read contract, then every key equal to its default (`Object.is`) is stripped — reading the stripped URL back restores the exact same value, so one read schema covers both directions.

```ts
import {writeSchema} from '@native-router/core';

// With `useSetSearch` of @native-router/react: writes serialize only
// what differs from the defaults, reads keep coercing/defaulting.
const write = writeSchema(listSearch, {page: 1});
write['~standard'].validate({page: 1}); // → {value: {}} — clean URL
write['~standard'].validate({page: 3}); // → {value: {page: 3}}
```

Keys become optional in the projection when they have a default or are already optional in the read output; other keys stay required. Sync in, sync out (an async read schema yields an async write schema), and a rejected read result passes through untouched.

## Fine-grained search invalidation

A navigation to the same pathname normally re-resolves the whole chain — every level's `beforeLoad`, `data`/`resolveView` and lazy `component` imports — however small the search change is. The optional `searchDeps` field (`searchDeps?: string[] | ((search: SearchInput) => unknown)`) declares the keys a level's resolution actually consumes; when every level of the matched chain declares them and no projection changed, the current view snapshot is re-served instead:

```ts
import {create} from '@native-router/core';
import {createBrowserHistory} from 'history';

const router = create(
  {
    path: '',
    searchDeps: [], // layout level: consumes nothing from the search
    children: [
      {
        path: '/articles',
        // Array form: the consumed keys, picked from the degraded
        // parseSearchInput input (strings; repeated keys as arrays)
        searchDeps: ['tag', 'offset', 'limit'],
        // Function form: receives the degraded input object; the returned
        // value is compared after JSON.stringify — return primitives or
        // stable-shaped values
        // searchDeps: (search) => [search.tag, search.offset]
      }
    ]
  },
  createBrowserHistory(),
  resolveView
);
```

- **Fast path:** `navigate()` to the same pathname where **every level of the matched chain declares `searchDeps`** and each level's projection is unchanged between the current entry and the target commits the current view snapshot as the new entry — zero guards, zero loaders, zero lazy loading, exactly like a POP hitting the `viewStack`. Framework setters built on `reusableEntry` (react's `useSearchParams`/`useSetSearch`) take the same path
- **Undeclared (`undefined`) is today's behavior, byte for byte:** any navigation re-resolves the whole chain as before this field existed; one undeclared level opts the whole chain out of the fast path
- **The contract cuts both ways — everything the level's resolution reads from the search must be declared:** keys the `search` schema validates strictly belong in `searchDeps` too (the fast path runs no schema, so an invalid value of an undeclared key lands in the URL unchecked — setters like react's `useSetSearch` validate the whole value before navigating regardless), and a `beforeLoad` guard that reads search keys must see them listed or it will not re-run when they change
- **`hash` and `state` are never compared** — they are not resolve inputs, so on a fully declared chain a hash-only navigation reuses the snapshot too
- **The re-served view is a snapshot:** it keeps its resolve-time context — `data` and matched `ctx` reflect the entry the view was resolved for; read live search through the framework's search hooks (react's `useSearch`/`useSearchParams` subscribe to history and are always current)
- POP replay, `initHistoryStack` warm-up, `refresh()` and `invalidate()` are untouched: `invalidate()` drops the snapshots, and the fast path stays off until the next real resolve

### `reusableEntry`

The check `navigate` runs internally, exported for framework navigation setters that commit a search update through the same semantics (react's `useSetSearch`/`useSearchParams` `{replace: true}` branch uses it directly):

```ts
export function reusableEntry<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  location: Location
): ResolvedEntry<V> | undefined;
```

Same pathname, the current entry has a view snapshot, the matched chain fully declared and projections unchanged → `{location, task: Promise.resolve(current view)}`; `undefined` otherwise — a different pathname, no match, no snapshot, an undeclared level, or a changed projection. "No" is the default: branch on it and resolve for real.

```ts
import {commit, reusableEntry, toLocation} from '@native-router/core';

const entry = reusableEntry(router, toLocation(router, '/articles?tag=react&offset=20'));
// entry.location — the target location
// entry.task    — resolves the current view, nothing resolves in flight
if (entry) commit(router, entry.task, entry.location); // commit like any resolved entry
```

## Params validation

Params are always strings (wildcards: string arrays) — the URL has no types. Declare a `params` schema on a route level and the core validates/coerces the merged params of that level before its `beforeLoad` runs, so guards see numbers instead of `Number(id)` everywhere.

```ts
import {create} from '@native-router/core';
import {z} from 'zod';

const router = create(
  {
    path: '',
    children: [
      {
        path: '/users/:id',
        params: z.object({id: z.coerce.number().int().positive()}),
        beforeLoad: ({params}) => {
          params.id; // number — coerced, or the navigation failed
        }
      }
    ]
  },
  createBrowserHistory(),
  (matched) => renderUser(matched)
);
```

- No `params` schema → behavior unchanged: the raw string map flows through
- The parse runs per level (shallow → deep): a level's schema validates the params merged up to it; a deeper schema sees the (possibly coerced) output of the shallower ones
- A `redirect` level skips its params schema entirely — the level's guard never runs, so there is nothing to hand coerced params to; the same asymmetry the search schema has (`redirect` wins over `beforeLoad`). Hanging a params schema on a redirect level is inert, it cannot fail the navigation
- A same-name param on both a parent and a child segment (`/users/:id/files/:id`): the deep-over-shallow merge operates on the **raw** strings, so the child segment's value overwrites the parent's coerced one — a child guard sees the raw string again. Declare the coercing schema on (or below) the deepest level that reads the param — a deeper schema validates the whole merged map anyway — or avoid reusing a param name across levels
- A rejected validation fails the resolution through the `errorHandler` channel with a `ParamsError` (a `NativeRouterError`) carrying the raw `params` and the reported `issues` — the same route a search-schema failure takes
- `parseParams`/`parseParamsSync` are exported for custom `resolveView` implementations (the async/sync flavors mirror `parseSearch`/`parseSearchSync`)

## Router context

Pass a `context` option to `create` and every router carries its own value, handed to guards as `ctx.context` (`GuardContext`) and to your `resolveView` as `ctx.context` (`ResolveViewContext`). It is the injection point for per-instance dependencies — an API client, config, i18n handles — that a module singleton cannot isolate: one router per test keeps fixtures from leaking across tests, one router per micro-frontend pane keeps panes from sharing state.

```ts
import {create, navigate} from '@native-router/core';

const router = create(
  {path: '', children: [{path: '/a', beforeLoad: ({context}) => context.api.ready()}]},
  createBrowserHistory(),
  (matched, {context}) => Promise.resolve(render(context.api, matched)),
  {context: {api: myApi}} // ← one value per instance, synchronous
);

router.context; // {api: myApi} — typed from the option
```

- The value's type is inferred from the option and flows into `RouterInstance<R, V, C>`'s `context` member; omit the option and everything stays exactly as before — the context is `undefined` and existing routers keep their types and behavior
- Thread the context type through the context generic to type a guard precisely: `GuardContext<R, S, P, {api: Api}>` (the same manual-generic pattern the `params`/`search` generics use — the route table is declared before the router, so the loose default cannot know the router's context)
- One value per instance, read synchronously: not a reactive store, nothing re-resolves on change, and it takes no part in the viewStack snapshot keys — instance-level state is naturally isolated between routers
- `@native-router/react` forwards the same option: `createRouter` options, `<Router>`/`HistoryRouter`/`HashRouter`/`MemoryRouter` props, and the `data` loader's `ctx.context` all carry it

## Design principles

**Navigation semantics follow the browser** — native-router aligns with browser-native navigation semantics, not with what other SPA routers happen to do. Every navigation API decision is measured against that yardstick; "a popular router has it" is not, by itself, a reason to follow. These are deliberate choices, not bugs to fix.

- **An in-flight navigation keeps the old view.** The chain — guards, loaders — settles as a whole, and only then commits and pushes (`history.push`). The browser does the same: the old document stays displayed until the new one commits. A superseded or cancelled navigation is the browser's stop button / ESC — you stay on the old page and the URL never moved.
- **Failure means an error view.** A failed resolve renders the error semantics (`errorHandler` in core, `errorComponent` in the react bindings) — the counterpart of the browser's error page. There is no "waited too long → switch to a loading view" path: the browser has no UI-layer load timeout; a timeout surfaces as a network-layer failure, i.e. an error page.
- **Corollary: no pending-timeout escalation.** No TanStack-style `pendingMs` / in-app `pendingComponent` timeout upgrade. A pending view renders only on cold start / refresh, when there is no old view to keep.

## Install

```bash
npm i @native-router/core
```

## Usage

```ts
import {create, listen, navigate} from '@native-router/core';
import {createBrowserHistory} from 'history';

const router = create(
  {
    path: '', // layout level: children match the full remaining path
    children: [{path: '/'}, {path: '/users/:id'}]
  },
  createBrowserHistory(),
  // Resolve the matched levels into a view of your own
  async (matched, {location}) => renderApp(matched, location),
  {baseUrl: '', errorHandler: (e) => renderError(e)}
);

const unlisten = listen(router, (view, action) => {
  // Called on every navigation; POP hits the cached view directly.
  // action: 'push' | 'replace' | 'pop' — the navigation disposition,
  // handed to e.g. the view-transition bindings as direction.
  mount(view, action);
});

await navigate(router, '/users/1'); // guards run, then commit pushes the view
```

Any extra route fields (e.g. `component`, `data`) pass through to your `resolveView` untouched — that is how `@native-router/react` builds its conventions on top of the core.

## Development

`@native-router/core` (this package) and `@native-router/react` live in **two independent repositories**; clone them side by side. The react repo's vitest config aliases `@native-router/core` to `../core/src`, so its tests exercise the latest core source without any install-level linking.

```bash
pnpm install
pnpm test   # core tests
pnpm build  # build core dist
```

React's type check and production build resolve core from the npm registry, so publish core first when react needs to consume unpublished core APIs.

## Documentation

[API](https://native-router.github.io/core/modules.html)
