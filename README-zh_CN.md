[![npm](https://img.shields.io/npm/v/@native-router/core.svg)](https://www.npmjs.com/package/@native-router/core)
[![Build Status](https://github.com/native-router/core/actions/workflows/ci.yml/badge.svg)](https://github.com/native-router/core/actions)
[![Coverage](https://img.shields.io/codecov/c/github/native-router/core.svg)](https://codecov.io/gh/native-router/core)
[![install size](https://packagephobia.now.sh/badge?p=@native-router/core)](https://packagephobia.now.sh/result?p=@native-router/core)

# Native Router Core

> 基于 [history](https://github.com/remix-run/history) 与 [path-to-regexp](https://github.com/pillarjs/path-to-regexp) 的框架无关路由内核：可取消的异步导航、内存视图栈与路由守卫。

[English](./README.md) | 简体中文

## 亮点

### 后退零请求

每次提交的导航都会把已解析的视图存进路由器的内存 `viewStack`。POP 导航通过 `listen` 直接命中缓存视图——不重新匹配、不重新解析。

```ts
import {create, listen} from '@native-router/core';
import {createBrowserHistory} from 'history';

const router = create(routes, createBrowserHistory(), resolveView);

const unlisten = listen(router, (view) => {
  // 前进/后退瞬间到达这里，拿到缓存视图
  mount(view);
});
```

### 刷新后会话恢复

会话栈以有界尾部窗口的形式序列化进 `history.state`（`maxStackDepth`，默认 100），`create` 时自动恢复。刷新后用 `initHistoryStack` 预热一次，窗口内的前进/后退全部从缓存渲染、零请求。窗口外的条目退化为单次惰性重解析。

```ts
const router = create(routes, createBrowserHistory(), resolveView);
// 刷新后栈已从 history.state 窗口恢复；
// 重新解析所有可达条目，让窗口内前进/后退零请求
await initHistoryStack(router);
```

### 面向预取的守卫感知解析

`resolveEntry` 先执行路由守卫（`redirect`/`beforeLoad`），返回终态 location 及其视图任务，链接因此能精确预取点击将要提交的内容。

```ts
import {resolveEntry, commit, toLocation} from '@native-router/core';

const entry = await resolveEntry(router, toLocation(router, '/users/1'));
// entry.location —— 应用守卫后的终态 location
// entry.task    —— 终态目标的视图任务
const view = await entry.task; // 预取 / 预览
commit(router, entry.task, entry.location); // 像点击一样提交
```

## 功能

- 框架无关：自带 `resolveView`，视图类型（`V`）由你决定——字符串、vdom 都可以
- 基于 path-to-regexp 的路由匹配：声明序匹配、无 `path` 布局路由、`path: ''` 索引/兜底子路由、尾部斜杠敏感、区分大小写、嵌套参数深层覆盖浅层
- 路由守卫：每层路由支持静态 `redirect` 与异步 `beforeLoad`，按浅层到深层执行；连续重定向超过 10 次以 `RedirectLoopError` 拒绝
- 可取消的异步导航：新的解析取代进行中的解析（`currentGuard`）；`cancel()` 主动中止；history POP 也会取消。被取代或被取消的 `navigate()` 返回的 promise **永远不会 settle**——不要 `await` 可能被取代的导航
- 导航 API：`navigate`、`refresh`、`go`/`forward`/`back`、`commit`/`commitReplace`、`createHref`、`getParams`、`match`、`toLocation`、`resolve`、`resolveTo`
- `preload(router, to, {ttl})`：提前经守卫解析目标，并发调用共享同一任务（in-flight 去重）并带 TTL（默认 30 秒）；commit 消费后即失效
- `errorHandler` 钩子把解析失败转换为兜底视图
- 错误类型：`NativeRouterError`、`NotFoundError`、`RedirectLoopError`
- Tree-Shaking 友好：`sideEffects: false`

## 匹配语义

- 路由按**声明顺序**匹配，先匹配者优先——不按特异性排序。
- **没有 `path`** 的路由是布局路由：匹配空前缀，子路由对完整剩余路径继续匹配。
- 叶子子路由声明 **`path: ''`** 时匹配父路由之下的任意剩余路径。声明在具体兄弟之后时，它充当父路由的索引路由（并兜底父路径下未匹配的路径）。
- **尾部斜杠敏感**：`/users/` 不会匹配 `/users`。
- 匹配**区分大小写**。
- 嵌套层级的参数**深层覆盖浅层**合并（`mergeMatchedParams`）：`/:id` + `/posts/:id` 时深层的 `id` 生效。

## 安装

```bash
npm i @native-router/core
```

## 使用

```ts
import {create, listen, navigate} from '@native-router/core';
import {createBrowserHistory} from 'history';

const router = create(
  {
    path: '', // 布局层级：子路由对完整剩余路径匹配
    children: [{path: '/'}, {path: '/users/:id'}]
  },
  createBrowserHistory(),
  // 把匹配到的层级解析成你自己的视图
  async (matched, {location}) => renderApp(matched, location),
  {baseUrl: '', errorHandler: (e) => renderError(e)}
);

const unlisten = listen(router, (view) => {
  // 每次导航都会回调；POP 直接命中缓存视图
  mount(view);
});

await navigate(router, '/users/1'); // 先跑守卫，再 commit 推入视图
```

路由上的任何扩展字段（如 `component`、`data`）都会原样传给你的 `resolveView`——`@native-router/react` 正是据此在内核之上构建自己的约定。

## 开发

`@native-router/core`（本包）与 `@native-router/react` 是**两个独立仓库**，并肩 clone 即可。react 仓库的 vitest 配置把 `@native-router/core` 别名到 `../core/src`，其测试无需任何安装层链接即可吃到最新 core 源码。

```bash
pnpm install
pnpm test   # core 测试
pnpm build  # 构建 core dist
```

react 的类型检查与生产构建从 npm registry 解析 core，react 需要消费未发布的 core API 时先发布 core。

## 文档

[API](https://native-router.github.io/core/modules.html)
