// SPDX-License-Identifier: Apache-2.0
/**
 * 「窗口回到前台」的单点广播。
 *
 * `useApi` 目前有 40 多处调用点。如果每处各挂一个 `visibilitychange`，就是 40 多个监听，
 * 且节流逻辑会散落到每个调用点。这里把监听收敛到一份：整页只注册一个监听，`useApi`
 * 按需订阅，退订到 0 时把监听一起摘掉。
 *
 * **只广播、不判断**：是否真的重拉由订阅者决定（`minIntervalMs` / `skip()` 都是每处
 * `useApi` 自己的语义，模块无从得知）。模块只做两件事：
 * 1. 只在 `document.visibilityState === "visible"` 时广播（切到后台不广播）；
 * 2. 同一波切回可能连发多次事件，用 `NOTIFY_GAP_MS` 合并成一次。
 *
 * 刻意不做轮询：本地单用户场景，定时打请求只是浪费。
 */

export type FocusRefreshListener = () => void;

/** 同一波切回的事件合并窗口：浏览器切回前台可能连发 visibilitychange / focus。 */
export const FOCUS_NOTIFY_GAP_MS = 50;

const listeners = new Set<FocusRefreshListener>();
let listening = false;
let lastNotifiedAt = 0;

/** 当前页面是否在前台。SSR / 无 document 时按「不可见」处理，宁可不拉。 */
export function isPageVisible(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible";
}

function notify(): void {
  const now = Date.now();
  if (now - lastNotifiedAt < FOCUS_NOTIFY_GAP_MS) return;
  lastNotifiedAt = now;
  // 快照遍历：订阅者在回调里退订不会让本轮漏掉其他人。
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 单个订阅者抛错不该连累其他页面的刷新。
    }
  }
}

function onVisibilityChange(): void {
  if (!isPageVisible()) return;
  notify();
}

/**
 * 订阅「回到前台」。返回退订函数；最后一个订阅者退订时摘掉全局监听。
 *
 * 订阅时**不会**立刻回调——挂载首屏由 `useApi` 自己的 effect 负责，重复回调等于双请求。
 */
export function subscribeFocusRefresh(listener: FocusRefreshListener): () => void {
  if (typeof document === "undefined") return () => {};
  listeners.add(listener);
  if (!listening) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    listening = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && listening) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      listening = false;
    }
  };
}

/** 测试用：清空订阅与合并窗口，避免用例之间互相节流。生产代码不要调用。 */
export function resetFocusRefreshForTests(): void {
  if (listening && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  listeners.clear();
  listening = false;
  lastNotifiedAt = 0;
}
