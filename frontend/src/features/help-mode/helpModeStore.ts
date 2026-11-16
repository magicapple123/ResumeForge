// SPDX-License-Identifier: Apache-2.0
/**
 * 「提示模式」（I-18）的模块级单例。
 *
 * 打开后所有 `HintDetail` 的 `ⓘ` 变成原地内联展开——用户按一次 `Alt+H` 就能把当前页
 * 所有说明一次读完，不用逐个点开、也不用逐个记住。再按一次、按 `Esc`、窗口失焦或换页
 * 都自动退出：这个模式是"临时把界面翻过来看一眼"，不该有任何粘滞感。
 *
 * ## 为什么是 store 而不是 Context
 *
 * `HintDetail` 出现在任意深度（表单 label 里、表格列头里、抽屉里），包一层 Provider
 * 意味着所有挂载点都得改；而仓库既有的这几处状态（`localeStore`、
 * `touTouProposalStore`、`workbenchLayoutStore`）都是"模块级快照 + subscribe +
 * `useSyncExternalStore`"。照抄同一形状，零 Provider、零重渲染放大的风险。
 *
 * 监听器**按需挂**（进入时才挂 Esc / blur，退出时立刻摘），页面平时一个 listener 都不多。
 */
import { useSyncExternalStore } from "react";

export interface HelpModeSnapshot {
  readonly active: boolean;
}

const INACTIVE: HelpModeSnapshot = Object.freeze({ active: false });
const ACTIVE: HelpModeSnapshot = Object.freeze({ active: true });

let snapshot: HelpModeSnapshot = INACTIVE;
const listeners = new Set<() => void>();

let detachWindowListeners: (() => void) | null = null;

function notify(): void {
  // 复制一份再遍历：监听器自己可能在回调里退订（例如徽标卸载）。
  for (const listener of [...listeners]) listener();
}

function publish(next: HelpModeSnapshot): void {
  if (snapshot.active === next.active) return;
  snapshot = next;
  notify();
}

function onKeyDown(event: KeyboardEvent): void {
  // 只认不带修饰键的 Esc：`Ctrl+Esc`/`Alt+Esc` 是系统组合，不该改变应用状态。
  if (event.key !== "Escape") return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  exitHelpMode();
}

function onWindowBlur(): void {
  // 切走窗口后回来时还留在提示模式里，用户会以为界面坏了（那时的内联展开已经把版面
  // 撑开，看起来像"点了一下就卡住"）。
  exitHelpMode();
}

function attachWindowListeners(): void {
  if (detachWindowListeners || typeof window === "undefined") return;
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", onWindowBlur);
  detachWindowListeners = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", onWindowBlur);
    detachWindowListeners = null;
  };
}

/** 当前快照（`useSyncExternalStore` 的 getSnapshot）。 */
export function getHelpModeSnapshot(): HelpModeSnapshot {
  return snapshot;
}

/** 服务端 / 首屏快照：与 `localeStore` 同一口径——默认关。 */
export function getServerHelpModeSnapshot(): HelpModeSnapshot {
  return INACTIVE;
}

export function subscribeHelpMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isHelpModeActive(): boolean {
  return snapshot.active;
}

export function enterHelpMode(): void {
  attachWindowListeners();
  publish(ACTIVE);
}

export function exitHelpMode(): void {
  publish(INACTIVE);
  detachWindowListeners?.();
}

/** 返回切换后的状态，方便调用方（快捷键）就地决定要不要 `preventDefault`。 */
export function toggleHelpMode(): boolean {
  if (snapshot.active) {
    exitHelpMode();
    return false;
  }
  enterHelpMode();
  return true;
}

/** 订阅组件用：提示模式是否开着。 */
export function useHelpMode(): boolean {
  const current = useSyncExternalStore(
    subscribeHelpMode,
    getHelpModeSnapshot,
    getServerHelpModeSnapshot,
  );
  return current.active;
}
