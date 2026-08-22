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
- Cancelable async navigation: a new resolve supersedes the in-flight one (`currentGuard`); `cancel()` aborts it; a history POP cancels it too. A superseded or cancelled `navigate()` promise **never settles** — don't `await` a navigation that might be superseded
- Navigation API: `navigate`, `refresh`, `go`/`forward`/`back`, `commit`/`commitReplace`, `createHref`, `getParams`, `match`, `toLocation`, `resolve`, `resolveTo`
- `preload(router, to, {ttl})`: resolve a target through the guards ahead of time, sharing one task across concurrent callers (in-flight dedup) with a TTL, default 30s; consumed entries are dropped on commit
- `errorHandler` hook turns resolve failures into fallback views
- Errors: `NativeRouterError`, `NotFoundError`, `RedirectLoopError`
- Tree-shakable: `sideEffects: false`

## Matching semantics

- Routes match in **declaration order** and the first match wins — there is no sorting by specificity.
- A route **without `path`** is a layout: it matches the empty prefix and its children are matched against the full remaining path.
- A leaf child with **`path: ''`** matches whatever is left under its parent. Declared after its concrete siblings it serves as the parent's index route (and as the fallback for paths unmatched under the parent).
- **Trailing slashes are significant**: `/users/` does not match `/users`.
- Matching is **case-sensitive**.
- Params of nested levels are merged **deep over shallow** (`mergeMatchedParams`): for `/:id` + `/posts/:id`, the deeper `id` wins.

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
