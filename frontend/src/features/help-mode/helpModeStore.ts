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
  /** 当前页面已挂载的 `HintDetail` 条数（I-28：徽标显示"本页 N 条说明"）。 */
  readonly hintCount: number;
}

let activeFlag = false;
/**
 * 已挂载的说明，**用 `Set<symbol>` 而不是自增/自减**。
 *
 * React StrictMode 会把组件挂载两次（挂载 → 卸载 → 再挂载）：`+1/-1` 在两次挂载之间
 * 会漂成 2，卸载一次又掉回 1，徽标上的数字就永远不准。按身份登记/注销则天然幂等。
 */
const hints = new Set<symbol>();
const listeners = new Set<() => void>();

let snapshot: HelpModeSnapshot = Object.freeze({ active: false, hintCount: 0 });
const SERVER_SNAPSHOT: HelpModeSnapshot = Object.freeze({ active: false, hintCount: 0 });

let detachWindowListeners: (() => void) | null = null;

function notify(): void {
  // 复制一份再遍历：监听器自己可能在回调里退订（例如徽标卸载）。
  for (const listener of [...listeners]) listener();
}

function publish(): void {
  const next: HelpModeSnapshot = { active: activeFlag, hintCount: hints.size };
  if (snapshot.active === next.active && snapshot.hintCount === next.hintCount) return;
  snapshot = Object.freeze(next);
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

/** 服务端 / 首屏快照：与 `localeStore` 同一口径——默认关、0 条。 */
export function getServerHelpModeSnapshot(): HelpModeSnapshot {
  return SERVER_SNAPSHOT;
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
  activeFlag = true;
  publish();
}

export function exitHelpMode(): void {
  activeFlag = false;
  publish();
  detachWindowListeners?.();
}

/** 返回切换后的状态，方便调用方（快捷键）就地决定要不要 `preventDefault`。 */
export function toggleHelpMode(): boolean {
  if (activeFlag) {
    exitHelpMode();
    return false;
  }
  enterHelpMode();
  return true;
}

/**
 * 登记一条说明（I-28）：返回注销函数，组件在 `useEffect` 的清理里调用。
 *
 * 登记发生在**两种模式都挂载**的前提下（`HintDetail` 平时也渲染 ⓘ），所以计数在进入
 * 提示模式之前就已经正确；若改成"进入时才数"，徽标第一帧永远是 0。
 */
export function registerHint(): () => void {
  const id = Symbol("hint");
  hints.add(id);
  publish();
  return () => {
    if (!hints.delete(id)) return;
    publish();
  };
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

/** 订阅组件用：本页已挂载的说明条数（徽标文案）。 */
export function useHintCount(): number {
  const current = useSyncExternalStore(
    subscribeHelpMode,
    getHelpModeSnapshot,
    getServerHelpModeSnapshot,
  );
  return current.hintCount;
}
