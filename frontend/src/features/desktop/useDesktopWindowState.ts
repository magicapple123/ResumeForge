// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面壳的窗口实态（问题清单 §19；本轮的 #34A / #34F）。
 *
 * 四个字段各有消费者：
 *  - `maximized`：「最大化 / 还原」的文案；
 *  - `fullscreen`：全屏时隐藏标题栏；
 *  - `alwaysOnTop`：「窗口 → 置顶」的勾选态（#34A）；
 *  - `editableFocus`：撤销 / 重做的可用性（#34F）。
 *
 * 两条硬约束（P1-1 的教训，拆分时别丢）：
 *  1. **快照只定文案，不定隐藏**：`getWindowState()` 拿的是主进程记的窗口状态，它可能
 *     比真实窗口更旧（第一次读取发生在窗口还没 ready 的时候、或者上次全屏退出时没写回）。
 *     一旦它误报 `fullscreen: true`，`data-hidden` 就让整条标题栏 display:none —— 32px
 *     不再占位，系统三颗按钮浮到页面内容上。全屏的真相只有两条：Chromium 的文档级全屏
 *     事件、以及主进程推送（onWindowState）。
 *  2. **菜单打开前重新读一次实态**（#34A / #34F）：勾选态与置灰态必须来自窗口，不能来自
 *     上一次打开菜单时的记忆——上一次动作失败、或者窗口被系统改过时，显示会和实态相反。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopShellBridge, DesktopWindowState } from "./desktopShellBridge";

export const EMPTY_WINDOW_STATE: DesktopWindowState = {
  maximized: false,
  fullscreen: false,
  alwaysOnTop: false,
  editableFocus: false,
};

/** 主进程快照里可以采信的部分：全屏只信真实事件与推送（约束 1）。 */
export function snapshotStatePatch(
  state?: DesktopWindowState | null,
): Partial<DesktopWindowState> | null {
  if (!state || typeof state !== "object") return null;
  const patch: Partial<DesktopWindowState> = { maximized: Boolean(state.maximized) };
  // 旧壳没有这两个字段：缺省时保留当前值，不要用 false 覆盖（会把置顶/可编辑焦点洗掉）。
  if (typeof state.alwaysOnTop === "boolean") patch.alwaysOnTop = state.alwaysOnTop;
  if (typeof state.editableFocus === "boolean") patch.editableFocus = state.editableFocus;
  return patch;
}

export interface DesktopWindowStateOptions {
  /**
   * 进入全屏时通知容器（标题栏马上要被隐藏，下拉没有意义）。走回调而不是让容器在
   * effect 里对 fullscreen 做 setState：那属于"订阅外部系统"的场景，回调用法也更直白。
   */
  onFullScreenChange?: (fullscreen: boolean) => void;
}

export interface DesktopWindowStateHandle {
  windowState: DesktopWindowState;
  /** 菜单打开前强制从主进程读一次实态。 */
  refresh: () => void;
  /** 用菜单动作回执里的实态就地更新（置顶切换后不必等下一次打开菜单）。 */
  merge: (patch: Partial<DesktopWindowState>) => void;
}

export function useDesktopWindowState(
  bridge: DesktopShellBridge,
  options: DesktopWindowStateOptions = {},
): DesktopWindowStateHandle {
  const [windowState, setWindowState] = useState<DesktopWindowState>(EMPTY_WINDOW_STATE);
  // 回调只在"外部状态变化"时调用，存进 ref 避免每次 render 都重订阅（推送回调只能注册一次）。
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const merge = useCallback((patch: Partial<DesktopWindowState>) => {
    setWindowState((previous) => ({ ...previous, ...patch }));
  }, []);

  const refresh = useCallback(() => {
    const pending = bridge.getWindowState?.();
    if (!pending) return;
    void pending
      .then((state) => {
        const patch = snapshotStatePatch(state);
        if (patch) setWindowState((previous) => ({ ...previous, ...patch }));
      })
      .catch(() => undefined);
  }, [bridge]);

  useEffect(() => {
    let active = true;
    const applySnapshot = (state?: DesktopWindowState | null) => {
      if (!active) return;
      const patch = snapshotStatePatch(state);
      if (patch) setWindowState((previous) => ({ ...previous, ...patch }));
    };
    const applyPushed = (state?: DesktopWindowState | null) => {
      if (!active || !state) return;
      // 推送的载荷是 { maximized, fullscreen }：合并而不是替换，否则置顶与可编辑焦点
      // 会被 undefined 洗成"关"（菜单文案与置灰状态随之抖动）。
      setWindowState((previous) => ({
        ...previous,
        maximized: Boolean(state.maximized),
        fullscreen: Boolean(state.fullscreen),
      }));
      if (state.fullscreen) optionsRef.current.onFullScreenChange?.(true);
    };
    const pending = bridge.getWindowState?.();
    if (pending) void pending.then(applySnapshot).catch(() => undefined);
    bridge.onWindowState?.(applyPushed);
    // `enter-html-full-screen` / `leave-html-full-screen` 是 Chromium 的文档级事件
    //（DOM 类型里没有它们，所以按 EventTarget 挂，不引入 any）。
    const docTarget = document as unknown as EventTarget;
    const onEnterFullScreen = () => {
      if (!active) return;
      setWindowState((previous) => ({ ...previous, fullscreen: true }));
      optionsRef.current.onFullScreenChange?.(true);
    };
    const onLeaveFullScreen = () => {
      if (active) setWindowState((previous) => ({ ...previous, fullscreen: false }));
    };
    docTarget.addEventListener("enter-html-full-screen", onEnterFullScreen);
    docTarget.addEventListener("leave-html-full-screen", onLeaveFullScreen);
    return () => {
      active = false;
      docTarget.removeEventListener("enter-html-full-screen", onEnterFullScreen);
      docTarget.removeEventListener("leave-html-full-screen", onLeaveFullScreen);
    };
  }, [bridge]);

  return { windowState, refresh, merge };
}
