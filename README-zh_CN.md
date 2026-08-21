[![npm](https://img.shields.io/npm/v/@native-router/core.svg)](https://www.npmjs.com/package/@native-router/core)
[![Build Status](https://github.com/native-router/core/actions/workflows/ci.yml/badge.svg)](https://github.com/native-router/core/actions)
[![Coverage](https://img.shields.io/codecov/c/github/native-router/core.svg)](https://codecov.io/gh/native-router/core)
[![install size](https://packagephobia.now.sh/badge?p=@native-router/core)](https://packagephobia.now.sh/result?p=@native-router/core)

# Native Router React

> 接近原生体验的 React 路由库。

[English](./README.md) | 简体中文

## 特性

- 异步导航
- 可取消
- 页面视图和数据并发拉取
- 链接页面预加载及预览
- 轻量小巧，Tree-Shaking 友好
- 支持 TreeShaking

## 匹配语义

路由按声明顺序匹配，先匹配者优先（first-match-wins），不会按特异性排序。尾部斜杠不容错（`/users/` 不会匹配 `/users`）。匹配区分大小写。

## 安装

```bash
npm i @native-router/core
```

## 使用

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

查看 [完整示例](/demos/)。

## 文档 

[API](https://native-router.github.io/core/modules.html)
