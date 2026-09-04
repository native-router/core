import {createPath} from 'history';
import type {Location, NavAction, RouterInstance} from './types';

/**
 * Navigation lifecycle event emitted to {@link onDebug} listeners. Purely
 * observational: nothing a listener does(no return value, no throw) can
 * change the navigation it observes — a listener error is swallowed as
 * background noise instead of leaking into the navigation pipeline.
 *
 * The event family and when each fires:
 *
 * - `nav-start` — a navigation chain begins resolving(`navigate`,
 *   `commit`, `commitReplace`, `refresh`, and the lazy re-resolve of a
 *   landed history entry whose snapshot is missing). `to` is the
 * requested target; guards may still redirect it.
 * - `nav-commit` — the chain committed: the history entry landed. `to`
 *   is the **terminal** location(guards may have redirected it away from
 *   the requested one), `duration` counts from the chain's `nav-start`.
 *   A POP served from the `viewStack` snapshot never starts a chain —
 *   it emits `nav-commit` alone with `replay: true` and `duration: 0`.
 * - `nav-supersede` — the chain was discarded because a newer
 *   navigation started while it was still in flight; `by` is the
 *   superseding chain's target path, `to`/`action` identify the
 *   superseded chain.
 * - `nav-cancel` — the chain was aborted by `cancel()`(explicitly, or
 *   through a history landing/unlisten that re-enters it).
 * - `nav-error` — the chain failed with a real error(`NotFoundError`,
 *   a loader rejection, ...); `error` carries it. Cancelled and
 *   superseded chains reject with `NavigationCancelledError` and emit
 *   their own event instead.
 *
 * 导航生命周期事件，仅观察、不影响行为。nav-start 时 `to` 是请求目标，
 * nav-commit 时 `to` 是守卫重定向后的最终落点；POP 命中 viewStack 快照的
 * 回放只发一条 `nav-commit`（`replay: true`，无 nav-start）。
 * @group Types
 * @category Debug
 */
export type DebugEvent =
  | {
      type: 'nav-start';
      /** Navigation kind of the chain(`'push' | 'replace' | 'pop'`). */
      action: NavAction;
      /** The requested target path(pathname+search+hash). */
      to: string;
      /** Emission time, epoch milliseconds. */
      at: number;
    }
  | {
      type: 'nav-commit';
      action: NavAction;
      /**
       * The committed path(pathname+search+hash) — the chain's terminal
       * location, which a guard redirect may have moved away from the
       * requested target.
       */
      to: string;
      at: number;
      /** Milliseconds from the chain's `nav-start`; `0` for a snapshot replay. */
      duration: number;
      /**
       * `true` when the commit served a `viewStack` snapshot — a POP
       * replay, zero requests, no `nav-start` before it. `false` is a
       * freshly resolved commit.
       */
      replay: boolean;
    }
  | {
      type: 'nav-supersede';
      action: NavAction;
      /** The superseded chain's requested target path. */
      to: string;
      at: number;
      /** Milliseconds the superseded chain stayed in flight. */
      duration: number;
      /** The superseding navigation's target path. */
      by: string;
    }
  | {
      type: 'nav-cancel';
      action: NavAction;
      /** The cancelled chain's requested target path. */
      to: string;
      at: number;
      /** Milliseconds the cancelled chain stayed in flight. */
      duration: number;
    }
  | {
      type: 'nav-error';
      action: NavAction;
      /** The failed chain's requested target path. */
      to: string;
      at: number;
      /** Milliseconds from the chain's `nav-start` to the failure. */
      duration: number;
      /** The error the chain failed with. */
      error: unknown;
    };

/**
 * Listener of {@link onDebug} navigation events.
 * @group Types
 * @category Debug
 */
export type DebugListener = (event: DebugEvent) => void;

/**
 * The in-flight navigation chain a {@link getDebugInfo} snapshot reports.
 * @group Types
 * @category Debug
 */
export type DebugChain = {
  action: NavAction;
  /** The chain's requested target path. */
  to: string;
  /** `nav-start` time, epoch milliseconds. */
  startedAt: number;
};

/**
 * Observability snapshot of a router, taken by {@link getDebugInfo} —
 * the poll-friendly counterpart of the {@link DebugEvent} stream.
 * @group Types
 * @category Debug
 */
export type DebugInfo = {
  /** Path of the current location(pathname+search+hash). */
  to: string;
  /** Absolute history index of the landed entry(history state `index`). */
  index: number;
  /**
   * Session window depth — the shared length of `locationStack` and
   * `viewStack`(bounded by `maxStackDepth`).
   */
  stackDepth: number;
  /** Absolute history index of the session window's first slot. */
  baseIndex: number;
  /** View snapshots currently held in the window(non-null `viewStack` slots). */
  snapshots: number;
  /** The in-flight navigation chain, or `null` when the router is idle. */
  resolving: DebugChain | null;
};

type DebugState = {
  listeners: Set<DebugListener>;
  chain?: DebugChain;
};

/**
 * Debug bookkeeping per router, module-level so the public
 * {@link RouterInstance} type surface stays stable(the same pattern the
 * blocker registry uses).
 */
const debugRegistry = new WeakMap<RouterInstance<any>, DebugState>();

function debugStateOf(router: RouterInstance<any>): DebugState {
  let state = debugRegistry.get(router);
  if (!state) {
    state = {listeners: new Set()};
    debugRegistry.set(router, state);
  }
  return state;
}

function emitDebug(router: RouterInstance<any>, event: DebugEvent) {
  const {listeners} = debugStateOf(router);
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Observability must not break its subject: a crashing listener is
      // background noise, swallowed here.
    }
  });
}

/**
 * Subscribe to the router's {@link DebugEvent navigation lifecycle
 * events}. Purely observational — the events describe navigations, they
 * never influence them — and free when unused: nothing is emitted, and
 * the router's per-navigation bookkeeping is a couple of property
 * writes. Also attached to every `create()`d router as the
 * `router.onDebug` method.
 *
 * 订阅导航生命周期事件。只观察不干预；未订阅时零事件。
 * @group Methods
 * @category Debug
 * @param router router instance
 * @param listener event callback
 * @returns unsubscribe - remove the listener(idempotent)
 */
export function onDebug(
  router: RouterInstance<any>,
  listener: DebugListener
): () => void {
  const state = debugStateOf(router);
  state.listeners.add(listener);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.listeners.delete(listener);
  };
}

/**
 * Take an observability snapshot of the router: the current location,
 * the session window's depth and base, how many view snapshots it
 * holds, and the in-flight navigation chain(if any). Works whether or
 * not any {@link onDebug} listener is registered. Also attached to
 * every `create()`d router as the `router.getDebugInfo` method.
 *
 * 路由可观察性快照：当前 location、窗口深度与基点、快照数、在飞导航链。
 * @group Methods
 * @category Debug
 * @param router router instance
 */
export function getDebugInfo(router: RouterInstance<any, any>): DebugInfo {
  const state = debugRegistry.get(router);
  const {location} = router.history;
  const {locationStack, viewStack} = router;
  const index = ((location.state || {}) as Partial<{index: number}>).index || 0;
  return {
    to: createPath(location),
    index,
    stackDepth: locationStack.length,
    baseIndex: (router as {baseIndex?: number}).baseIndex ?? index,
    snapshots: viewStack.reduce((n, v) => n + (v != null ? 1 : 0), 0),
    resolving: state?.chain ?? null
  };
}

/**
 * Mark a navigation chain as started(the `resolving` snapshot of
 * {@link getDebugInfo}) and emit its `nav-start`.
 * @internal
 */
export function markDebugChain(
  router: RouterInstance<any>,
  action: NavAction,
  location: Location
): DebugChain {
  const chain: DebugChain = {
    action,
    to: createPath(location),
    startedAt: Date.now()
  };
  debugStateOf(router).chain = chain;
  emitDebug(router, {
    type: 'nav-start',
    action: chain.action,
    to: chain.to,
    at: chain.startedAt
  });
  return chain;
}

/**
 * Emit `nav-commit` for a settled chain and clear its in-flight record.
 * `committed` is the terminal location the chain committed, not the
 * requested one.
 * @internal
 */
export function emitDebugCommit(
  router: RouterInstance<any>,
  chain: DebugChain,
  committed: Location
) {
  debugStateOf(router).chain = undefined;
  const at = Date.now();
  emitDebug(router, {
    type: 'nav-commit',
    action: chain.action,
    to: createPath(committed),
    at,
    duration: at - chain.startedAt,
    replay: false
  });
}

/**
 * Emit `nav-error` for a failed chain and clear its in-flight record.
 * @internal
 */
export function emitDebugError(
  router: RouterInstance<any>,
  chain: DebugChain,
  error: unknown
) {
  debugStateOf(router).chain = undefined;
  const at = Date.now();
  emitDebug(router, {
    type: 'nav-error',
    action: chain.action,
    to: chain.to,
    at,
    duration: at - chain.startedAt,
    error
  });
}

/**
 * Emit `nav-cancel` for the in-flight chain(only one exists at a time)
 * and clear its record. No-op when the router is idle.
 * @internal
 */
export function emitDebugCancel(router: RouterInstance<any>) {
  const state = debugStateOf(router);
  const {chain} = state;
  state.chain = undefined;
  if (!chain) return;
  const at = Date.now();
  emitDebug(router, {
    type: 'nav-cancel',
    action: chain.action,
    to: chain.to,
    at,
    duration: at - chain.startedAt
  });
}

/**
 * Emit `nav-supersede` for the in-flight chain discarded by a newer
 * navigation and clear its record. No-op when the router is idle.
 * @internal
 */
export function emitDebugSupersede(router: RouterInstance<any>, by: string) {
  const state = debugStateOf(router);
  const {chain} = state;
  state.chain = undefined;
  if (!chain) return;
  const at = Date.now();
  emitDebug(router, {
    type: 'nav-supersede',
    action: chain.action,
    to: chain.to,
    at,
    duration: at - chain.startedAt,
    by
  });
}

/**
 * Emit the standalone `nav-commit` of a POP served from the `viewStack`
 * snapshot: no chain ever started, zero requests, `duration` is `0`.
 * @internal
 */
export function emitDebugReplay(router: RouterInstance<any>, to: Location) {
  emitDebug(router, {
    type: 'nav-commit',
    action: 'pop',
    to: createPath(to),
    at: Date.now(),
    duration: 0,
    replay: true
  });
}
