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

const unlisten = listen(router, (view, action) => {
  // 前进/后退瞬间到达这里，拿到缓存视图
  // action: 'push' | 'replace' | 'pop' —— 本次导航的落位方式
  mount(view, action);
});
```

`viewStack` 是 SPA 内导航对应的 [bfcache](https://web.dev/articles/bfcache)。浏览器为跨文档导航快照整个文档，后退/前进瞬时还原；路由器为同文档导航（`pushState`/POP）快照已解析视图，达到同样效果。两层互补且不重叠：同文档导航不会进入 bfcache，bfcache 还原也不触发 `popstate`。与数据层叠加后构成三层缓存 **bfcache > viewStack > queryCache**，恢复从外向内短路——任一外层命中即零请求，新鲜度由边缘补偿（如 query 层的 focus 重验证）。

快照可能活过它的有效期——登出或切换账号后，上一账号的已解析视图正是后退 POP 不该还原的东西。`invalidate(router)` 一次性丢弃全部快照：当前已渲染视图不受影响（不重解析、不重渲染），下一次前进/后退经与窗口外条目相同的惰性路径重跑落点条目的守卫与加载器。

```ts
import {invalidate} from '@native-router/core';

// 会话身份变化后：当前视图继续渲染，
// 但后退/前进绝不再还原上一账号的快照。
invalidate(router);
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
- 基于 path-to-regexp 的路由匹配：特异性排序（静态段 > 动态段 > splat，平分时声明顺序决胜）、无 `path` 布局路由、`path: ''` 索引/兜底子路由、尾部斜杠敏感、区分大小写、嵌套参数深层覆盖浅层
- 路由守卫：每层路由支持静态 `redirect` 与异步 `beforeLoad`，按浅层到深层执行；连续重定向超过 10 次以 `RedirectLoopError` 拒绝
- 可取消的异步导航：新的解析取代进行中的解析（`currentGuard`）；`cancel()` 主动中止；history POP 也会取消。被取代或被取消的 `navigate()` 返回的 promise 会以 `NavigationCancelledError` reject——主动且即时，不等被中止的解析自行 settle，`await` 不会悬挂在被丢弃的导航上（被否决的导航正常 resolve：否决是用户的正常决定，不是失败）。即发即忘的调用点挂一个 no-op catch 即可（react 绑定的 `Link` 与各 setter 即如此）。取代/取消同时会 abort 该导航链的 `AbortSignal`：守卫（`beforeLoad` ctx）与视图加载器（`ResolveViewContext`）通过 `ctx.signal` 收到它，进行中的请求真正停止而非仅丢弃结果；`preload` 的解析运行在自己的 signal 之下，只有并发上限会将其 abort
- 导航拦截器：`setBlocker(router, fn)` 注册同步的 `(to, from) => boolean` 否决谓词（入参为路径字符串），在每条 `navigate`/`commit`/`commitReplace` 链头与每个 history POP 落地前询问；被否决的导航不会启动，其 promise 立即 resolve（否决是用户的正常决定——不是错误——而被取消的导航以 `NavigationCancelledError` reject），被否决的 POP 以反向 `go()` 回退、且不影响进行中的导航——经典的未保存提醒守卫。`refresh` 与守卫重定向永不被阻塞
- 导航 API：`navigate`、`refresh`、`go`/`forward`/`back`、`commit`/`commitReplace`、`createHref`、`getParams`、`match`、`toLocation`、`resolve`、`resolveTo`
- `invalidate(router)`：一次性丢弃会话视图快照——当前视图保持渲染（不重解析、不重渲染），下一次前进/后退经守卫重新解析；典型调用点是登出/切换账号之后，防止 POP 回退渲染上一账号数据或绕过会话内已执行过的守卫
- 可观察性：每个路由器自带 `onDebug`/`getDebugInfo`（见「可观察性 / debug 事件」一节）——纯观察的导航生命周期事件流（`nav-start`/`nav-commit`/`nav-cancel`/`nav-supersede`/`nav-error`，带 POP 快照回放标志）加可轮询的状态快照；未使用时零开销
- 基于 [Standard Schema](https://standardschema.dev) 的 search 校验：任意路由层可声明 `search` 校验器（zod/valibot/arktype，无硬依赖），用 `parseSearch`/`parseSearchSync` 解析；失败抛出 `SearchError`
- 基于 `searchDeps` 的 search 精细失效：在每层声明本层解析消费的 search 键（`[]` = 完全不消费，函数形式自行推导投影），同路径导航若每层投影不变，直接复用当前视图快照——零守卫、零 loader、零懒加载，与 POP 命中 `viewStack` 完全一致；未声明的层保持「每次导航重解析」的现状（逐字节一致）；`reusableEntry` 导出该判定，供框架 setter 以同一语义提交 search 写入
- `preload(router, to, {ttl})`：提前经守卫解析目标，并发调用共享同一任务（in-flight 去重）并带 TTL（默认 30 秒）；commit 消费后即失效。预取有界且可取消：每次预取运行在自己的 `AbortSignal` 下（经 `ctx.signal` 交给守卫与加载器），在飞数量超出 `preloadConcurrency`（默认 4，`create` 选项）时最旧者按 FIFO 被 abort——缓存槽位随之丢弃、失败按后台语义吞掉；被导航消费的预取绝不会被上限中止
- `errorHandler` 钩子把解析失败转换为兜底视图
- 错误类型：`NativeRouterError`、`NotFoundError`、`RedirectLoopError`、`SearchError`、`NavigationCancelledError`
- Tree-Shaking 友好：`sideEffects: false`

## 匹配语义

- 枚举全部匹配链，**最特异者胜**：按路径段计分，静态文本段 > 动态 `:param` 段 > splat `*wildcard` 段，每段累加进整条链的分数——段更多的链（钉住更多 URL 内容）胜过段少的链。平分时退回**声明顺序**决胜。父路由前缀命中但子路由全部不匹配时，不会遮蔽后续兄弟路由——例如 `[{path: '/a', children: [{path: '/b'}]}, {path: '/*rest'}]` 中 `/a/q` 由通配路由接住。
- **没有 `path`** 的路由是布局路由：匹配空前缀，子路由对完整剩余路径继续匹配。
- 叶子子路由声明 **`path: ''`** 时匹配父路由之下的任意剩余路径。声明在具体兄弟之后时，它充当父路由的索引路由（并兜底父路径下未匹配的路径）。
- **尾部斜杠敏感**：`/users/` 不会匹配 `/users`。
- 匹配**区分大小写**。
- 嵌套层级的参数**深层覆盖浅层**合并（`mergeMatchedParams`）：`/:id` + `/posts/:id` 时深层的 `id` 生效。

## Search 校验

在路由层上声明 `search` 校验器，并在你的 `resolveView` 里解析 `location.search`。任何 [Standard Schema](https://standardschema.dev) 校验器都可用——zod、valibot、arktype 均实现了该接口——内核因此保持零新增运行时依赖。

```ts
import {create, parseSearch} from '@native-router/core';
import {z} from 'zod';

const listSearch = z.object({page: z.coerce.number().default(1)});

const router = create(
  {path: '', children: [{path: '/list', search: listSearch}]},
  createBrowserHistory(),
  // 你的 resolveView 自行消费 route.search：先解析 location.search，
  // 再用解析结果渲染视图
  async (matched, {location}) =>
    renderList(await parseSearch(matched.at(-1)!.route.search!, location.search))
);
```

- `parseSearchInput(search)` 把查询串退化为普通对象——单值键是字符串，查询串中重复的键是数组——它同时也是所有 schema 校验的输入
- `parseSearch(schema, search)` 解析出 schema 输出（异步校验器会被 await）；`parseSearchSync` 是渲染时机的同步版本，遇到异步校验器会抛出明确的错误
- 守卫：`beforeLoad` 以 `ctx.search` 收到该层解析后的 search——schema 输出（经 `parseSearch` 解析，异步校验器可用），无 schema 的层退化为输入对象；校验不通过时与 data 阶段的 search 错误一样走 `errorHandler` 通道
- 校验不通过抛出 `SearchError`（`NativeRouterError` 的子类），携带原始 `search` 与 schema 报告的 `issues`——像其他解析失败一样交给 `errorHandler` 处理

### 写 search 不脏 URL

读侧 schema 会 coerce 并补缺省，把它的输出直接写回 URL 就会把缺省值带进 query（每个链接都挂 `?offset=0&limit=10`）。`writeSchema(schema, defaults)` 从读 schema 派生写侧孪生：值先经同一读契约校验，再抹去等于缺省（`Object.is`）的键——被抹后的 URL 读回来还原出同一个值，一份读 schema 管住双向。

```ts
import {writeSchema} from '@native-router/core';

// 配 @native-router/react 的 useSetSearch：写入只序列化偏离缺省的
// 部分，读取照旧 coerce/补缺省。
const write = writeSchema(listSearch, {page: 1});
write['~standard'].validate({page: 1}); // → {value: {}} —— 干净 URL
write['~standard'].validate({page: 3}); // → {value: {page: 3}}
```

投影里「有缺省」或「读侧本就可选」的键变可选，其余键保持必选。同步进同步出（异步读 schema 得到异步写 schema），读侧拒绝的结果原样透传。

## Search 精细失效

同路径名导航默认重跑整条链——每层的 `beforeLoad`、`data`/`resolveView` 与懒加载 `component`——哪怕 search 的变化再小。可选字段 `searchDeps`（`searchDeps?: string[] | ((search: SearchInput) => unknown)`）声明本层解析实际消费的键；匹配链每层都声明且投影不变时，直接复用当前视图快照：

```ts
import {create} from '@native-router/core';
import {createBrowserHistory} from 'history';

const router = create(
  {
    path: '',
    searchDeps: [], // 布局层：完全不消费 search
    children: [
      {
        path: '/articles',
        // 数组形式：消费的键，从 parseSearchInput 的降级输入
        // （字符串；重复键为数组）里按键取值
        searchDeps: ['tag', 'offset', 'limit'],
        // 函数形式：接收降级输入对象，返回值经 JSON.stringify 比较——
        // 返回原始值或形状稳定的值即可
        // searchDeps: (search) => [search.tag, search.offset]
      }
    ]
  },
  createBrowserHistory(),
  resolveView
);
```

- **快路径**：`navigate()` 目标为同 pathname、匹配链上**每层都声明了 `searchDeps`** 且每层投影在当前条目与目标之间不变 → 当前视图快照直接作为新条目提交——零守卫、零 loader、零懒加载，与 POP 命中 `viewStack` 完全一致。基于 `reusableEntry` 构建的框架 setter（react 的 `useSearchParams`/`useSetSearch`）走同一条路径
- **schema 仍然校验**：复用快照前，目标的原始 search 会先过匹配链上每层声明的 `search` schema——被拒即放弃快路径，由完整重解析经既有错误通道抛出 `SearchError`，非法值绝不会免校验落进 URL。异步 search schema 则整链退出快路径（其判定无法同步等待）
- **未声明（`undefined`）即现状，逐字节一致**：任何导航照旧整链重解析，与本特性之前的行为相同；链上任一层未声明 → 整链不走快路径
- **契约是双向的——本层解析从 search 读到的一切都必须声明**：`beforeLoad` 守卫读取的 search 键必须声明，否则这些键变化时守卫不会重跑
- **`hash` 与 `state` 永不参与比较**——它们不是 resolve 输入，全声明链上纯 hash 导航同样复用快照
- **复用的视图是快照**：保留其 resolve 期上下文——`data` 与 matched `ctx` 是产生该视图那次 resolve 的快照；活 search 要用框架的 search hooks 读取（react 的 `useSearch`/`useSearchParams` 订阅 history，恒最新）
- POP 回放、`initHistoryStack` 预热、`refresh()` 与 `invalidate()` 不受影响：`invalidate()` 清掉快照后，快路径失效直到下一次真实 resolve

### `reusableEntry`

`navigate` 内部运行的判定，导出给以同一语义提交 search 更新的框架导航 setter（react 的 `useSetSearch`/`useSearchParams` 的 `{replace: true}` 分支直接使用）：

```ts
export function reusableEntry<R extends BaseRoute = BaseRoute, V = any>(
  router: RouterInstance<R, V>,
  location: Location
): ResolvedEntry<V> | undefined;
```

同 pathname、当前条目有视图快照、匹配链全声明且投影不变 → 返回 `{location, task: Promise.resolve(当前视图)}`；否则返回 `undefined`——pathname 不同、未匹配、无快照、任一层未声明或投影变化。「否」是默认答案：拿到 `undefined` 就走真实解析。

```ts
import {commit, reusableEntry, toLocation} from '@native-router/core';

const entry = reusableEntry(router, toLocation(router, '/articles?tag=react&offset=20'));
// entry.location —— 目标 location
// entry.task    —— resolve 当前视图，没有任何解析在进行
if (entry) commit(router, entry.task, entry.location); // 像普通解析条目一样提交
```

## Params 校验

params 恒为字符串（通配符为字符串数组）——URL 没有类型。在路由层声明 `params` schema，内核会在该层 `beforeLoad` 之前校验/coerce 该层及祖先合并后的 params，守卫拿到的是 number，不再到处 `Number(id)`。

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
          params.id; // number——已 coerce，否则导航已失败
        }
      }
    ]
  },
  createBrowserHistory(),
  (matched) => renderUser(matched)
);
```

- 不声明 `params` → 行为不变：原始字符串照常下发
- 逐层解析（浅 → 深）：每层的 schema 校验合并到该层为止的 params；更深一层的 schema 看到的是浅层（可能已 coerce）的输出
- `redirect` 层会整体跳过其 params schema——该层守卫本就不会运行，coerce 结果无处可去；与 search schema 的不对称一致（`redirect` 优先于 `beforeLoad`）。在 redirect 层挂 params schema 是惰性的，不会导致导航失败
- 父子层级同名参数段（`/users/:id/files/:id`）：无 schema 的子层以**相同**原始值重声明时，保留父层已 coerce 的结果（`{id: 7}` 保持 number）；子层声明自己的 `params` schema 时，该键重新绑定为子层原始字符串，由子层 schema 对 URL 侧的值做 coerce。子层段的值**不同**则是新的绑定——深层字符串照常胜出，与原始合并一致。把 coerce schema 声明在读取该参数的最深层或更深层，仍是覆盖所有场景的通用做法
- 校验不通过走 `errorHandler` 通道抛出 `ParamsError`（`NativeRouterError` 的子类），携带原始 `params` 与 `issues`——与 search schema 失败同一条路
- `parseParams`/`parseParamsSync` 一并导出，供自定义 `resolveView` 使用（异步/同步版本对应 `parseSearch`/`parseSearchSync`）

## Router 上下文

给 `create` 传 `context` 选项，每个 router 实例携带一份自己的值：守卫从 `ctx.context`（`GuardContext`）拿到它，自定义 `resolveView` 从 `ctx.context`（`ResolveViewContext`）拿到它。它是按实例注入依赖（API client、配置、i18n 句柄）的注入点——模块单例做不到的隔离：每个测试一个 router，fixture 不会串；每个微前端面板一个 router，面板之间不共享状态。

```ts
import {create, navigate} from '@native-router/core';

const router = create(
  {path: '', children: [{path: '/a', beforeLoad: ({context}) => context.api.ready()}]},
  createBrowserHistory(),
  (matched, {context}) => Promise.resolve(render(context.api, matched)),
  {context: {api: myApi}} // ← 每实例一份，同步值
);

router.context; // {api: myApi} —— 类型由该选项推导
```

- 值的类型由选项推导，流入 `RouterInstance<R, V, C>` 的 `context` 成员；不传该选项则一切照旧——context 为 `undefined`，现有 router 的类型与行为零改动
- 要给守卫精确类型，把 context 类型穿过泛型传入：`GuardContext<R, S, P, {api: Api}>`（与 `params`/`search` 泛型的手动标注同一套路——路由表声明在 router 之前，宽松默认值无从得知 router 的 context 类型）
- 每实例一份、同步读取：不是响应式 store，变更不触发任何重新解析，也不参与 viewStack 快照 key——实例级状态天然互相隔离
- `@native-router/react` 透传同一选项：`createRouter` 的 options、`<Router>`/`HistoryRouter`/`HashRouter`/`MemoryRouter` 的 props、以及 `data` loader 的 `ctx.context` 都携带它

### 路由级上下文

路由还可以声明自己的 `context` 对象。它**覆盖合并**在 router context 之上（同名 key 路由优先），作用于声明它的层级及其所有更深层级：

```ts
const routes = {
  path: '',
  context: {theme: 'light'}, // ← 布局级默认值
  children: [
    {
      path: '/admin',
      context: {role: 'admin'}, // ← 继承 theme，追加 role
      children: [
        // 该守卫的 ctx.context 是 {theme: 'light', role: 'admin'}
        {path: '/audit', beforeLoad: ({context}) => context.role === 'admin' || context.theme}
      ]
    }
  ]
};
```

- `beforeLoad` 守卫收到「累积到自身层级」的合并结果（祖先的声明加上自己的），与 `params` 的逐级累积完全同构；`resolveView` 收到整条匹配链的全量合并
- 不声明 `context`（或声明为 `null`）的层级不贡献任何东西——从不声明路由 context 的表拿到的仍是原样的实例 context，逐字节不变
- 合并是解析时的一次浅拷贝：非响应式，事后修改声明的对象不会触发任何重新解析

## 可观察性 / debug 事件

路由器内置一层面向 DevTool 类消费方的最小观察面。**opt-in、只观察不干预**——事件描述导航，绝不影响导航；未注册监听时零事件，每条导航的簿记开销只有几次属性写入。

```ts
import {create, listen, navigate} from '@native-router/core';

const router = create(routes, history, resolveView);

// 挂在 router 实例上（等价的独立函数：onDebug(router, fn)）
const off = router.onDebug((event) => console.log(event));
const info = router.getDebugInfo(); // 可轮询的状态快照
```

`onDebug` 输出导航生命周期事件流：

| 事件 | 触发时机 | 特有字段 |
| --- | --- | --- |
| `nav-start` | 导航链开始解析（`navigate`/`commit`/`commitReplace`/`refresh`，或落位条目缺快照时的惰性重解析） | `action`、`to`（**请求**目标） |
| `nav-commit` | 链已提交——history 条目落位 | `to`（**最终**落点，含守卫重定向）、距 `nav-start` 的 `duration` 毫秒、`replay` |
| `nav-supersede` | 链在飞行中被更新的导航取代 | `by`——取代者的目标路径 |
| `nav-cancel` | 链被 `cancel()` 中止（显式调用，或被 history 落位/unlisten 重入） | |
| `nav-error` | 链以真实错误失败（`NotFoundError`、loader 拒绝……） | `error` |

每个事件都带 `action`（`'push' | 'replace' | 'pop'`）、相关的 `to` 路径和 epoch 毫秒的 `at` 时间戳。两个值得注意的细节：

- **POP 快照回放是一条孤立的 `nav-commit`。** 命中 `viewStack` 快照的 POP 不经过链——只发一条 `nav-commit`，`action: 'pop'`、`replay: true`、`duration: 0`。未命中快照的 POP（窗口外，或 `invalidate()` 之后）走重解析，完整报告 `nav-start` → `nav-commit`，`replay: false`，且保留落位的 `pop` 动作。
- **`nav-commit.to` 是最终落点。** 守卫重定向会把落点挪离请求；`nav-start.to` 保留请求目标，`nav-commit.to` 报告实际落位。

`getDebugInfo()` 是事件流的快照补充——当前 location、history `index`、会话窗口深度（`stackDepth`）与基点（`baseIndex`）、窗口内持有的视图快照数（`snapshots`）、在飞导航链（`resolving`：`{action, to, startedAt}` 或 `null`）。无论有没有监听者都能用，面板可以一边用 `onDebug` 渲染事件时间线，一边轮询它。

抛异常的监听者会被吞掉——可观察性不能破坏被观察者。react 绑定把同一观察面封装为 `useRouteDebug` hook。

## 设计原则

**导航语义跟随浏览器**——native-router 对齐的是浏览器原生导航语义（browser-native navigation semantics），而非其它 SPA 路由库的行为。后续所有导航 API 设计决策都以此为唯一准绳，「某个流行 router 有」本身不构成跟进的理由。这些是有意设计，不是待修的 bug。

- **进行中的导航保留旧视图。** 整条链——守卫、加载器——全部 settle 后才 commit 并 `history.push`。对应浏览器：旧文档一直显示到新文档 commit。导航被取代/取消即浏览器的 stop/ESC——留在旧页，URL 分毫未动。
- **失败即错误视图。** 解析失败走错误渲染语义（core 的 `errorHandler`，react 绑定的 `errorComponent`）——对应浏览器错误页。不存在「等待超时 → 切换 loading 页」：浏览器没有 UI 层加载超时，超时表现为网络层失败的错误页。
- **推论：不做 pending 超时升级。** 不引入 TanStack 式 `pendingMs` / in-app `pendingComponent` 超时升级；pending 视图仅在冷启动/刷新（无旧视图可保）时渲染。

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

const unlisten = listen(router, (view, action) => {
  // 每次导航都会回调；POP 直接命中缓存视图
  // action: 'push' | 'replace' | 'pop' —— 导航落位方式，可作为
  // 视图过渡等绑定的方向信号
  mount(view, action);
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
