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

const unlisten = listen(router, (view) => {
  // Back/forward lands here instantly with the cached view
  mount(view);
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
- Route matching via path-to-regexp: declaration order, layout routes without `path`, index/fallback children with `path: ''`, strict trailing slashes, case-sensitive, nested params merged deep over shallow
- Route guards: static `redirect` and async `beforeLoad` on every route level, run shallow → deep; more than 10 chained redirects reject with `RedirectLoopError`
- Cancelable async navigation: a new resolve supersedes the in-flight one (`currentGuard`); `cancel()` aborts it; a history POP cancels it too. A superseded or cancelled `navigate()` promise **never settles** — don't `await` a navigation that might be superseded. Superseding or cancelling also aborts the chain's `AbortSignal`: guards (`beforeLoad` ctx) and view loaders (`ResolveViewContext`) receive it as `ctx.signal`, so their in-flight requests stop instead of only having results dropped; `preload` resolutions are shared and therefore never aborted
- Navigation blockers: `setBlocker(router, fn)` registers a synchronous `(to, from) => boolean` veto over path strings, asked at the head of every `navigate`/`commit`/`commitReplace` and before a history POP lands; a vetoed navigation never starts and its promise resolves immediately (a veto is not an error — unlike a cancelled navigation, whose promise never settles), a vetoed POP is rewound with a counter-`go()` that leaves any in-flight navigation running — the classic unsaved-changes guard. `refresh` and guard redirects are never blocked
- Navigation API: `navigate`, `refresh`, `go`/`forward`/`back`, `commit`/`commitReplace`, `createHref`, `getParams`, `match`, `toLocation`, `resolve`, `resolveTo`
- `invalidate(router)`: drop the session view snapshots in one call — the current view stays rendered (no re-resolve, no re-render) and the next back/forward re-resolves through the guards; the typical call site is right after a logout/account switch, so a POP cannot render the previous account's data or bypass guards that already ran
- Search validation via [Standard Schema](https://standardschema.dev): a `search` schema on any route level (zod/valibot/arktype, no hard dependency), parsed with `parseSearch`/`parseSearchSync`; failures throw `SearchError`
- `preload(router, to, {ttl})`: resolve a target through the guards ahead of time, sharing one task across concurrent callers (in-flight dedup) with a TTL, default 30s; consumed entries are dropped on commit
- `errorHandler` hook turns resolve failures into fallback views
- Errors: `NativeRouterError`, `NotFoundError`, `RedirectLoopError`, `SearchError`
- Tree-shakable: `sideEffects: false`

## Matching semantics

- Routes match in **declaration order** and the first match wins — there is no sorting by specificity.
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
- A rejected validation fails the resolution through the `errorHandler` channel with a `ParamsError` (a `NativeRouterError`) carrying the raw `params` and the reported `issues` — the same route a search-schema failure takes
- `parseParams`/`parseParamsSync` are exported for custom `resolveView` implementations (the async/sync flavors mirror `parseSearch`/`parseSearchSync`)

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

const unlisten = listen(router, (view) => {
  // Called on every navigation; POP hits the cached view directly
  mount(view);
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
