[![npm](https://img.shields.io/npm/v/@native-router/core.svg)](https://www.npmjs.com/package/@native-router/core)
[![Build Status](https://github.com/native-router/core/actions/workflows/ci.yml/badge.svg)](https://github.com/native-router/core/actions)
[![Coverage](https://img.shields.io/codecov/c/github/native-router/core.svg)](https://codecov.io/gh/native-router/core)
[![install size](https://packagephobia.now.sh/badge?p=@native-router/core)](https://packagephobia.now.sh/result?p=@native-router/core)

# Native Router React

> A route close to the native experience for react.

English | [简体中文](./README-zh_CN.md)

## Features

- Asynchronous navigation
- Cancelable
- Page data concurrent fetch
- Link prefetch and preview
- Most unused features can be tree-shaking
- SSR support

## Matching semantics

Routes are matched in declaration order and the first match wins — there is no sorting by specificity. Trailing slashes are significant (`/users/` does not match `/users`). Matching is case-sensitive.

## Install

```bash
npm i @native-router/core
```

## Usage

```tsx
import {View, HistoryRouter as Router} from '@native-router/core';
import Loading from '@/components/Loading';
import RouterError from '@/components/RouterError';
import * as userService from '@/services/user';

export default function App() {
  return (
    <Router
      routes={{
        component: () => import('./Layout'),
        children: [
          {
            path: '/',
            component: () => import('./Home')
          },
          {
            path: '/users',
            component: () => import('./UserList'),
            data: userService.fetchList
          },
          {
            path: '/users/:id',
            component: () => import('./UserProfile'),
            data: ({id}) => userService.fetchById(+id)
          },
          {
            path: '/help',
            component: () => import('./Help')
          },
          {
            path: '/about',
            component: () => import('./About')
          }
        ]
      }}
      baseUrl="/demos"
      errorHandler={(e) => <RouterError error={e} />}
    >
      <View />
      <Loading />
    </Router>
  );
}

```
See [demos](/demos/) for a complete example.

## Documentation 

[API](https://native-router.github.io/core/modules.html)
