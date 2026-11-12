// SPDX-License-Identifier: Apache-2.0
/**
 * 「焦点是否在可编辑区」（#34F）：撤销 / 重做菜单项是否置灰的依据。
 *
 * 为什么不能直接看此刻的 activeElement：点菜单会把焦点交给触发按钮（或先由 Alt 交给
 * 菜单栏），那一刻 activeElement 一定不是输入框——按"此刻"判定，撤销永远置灰。所以记住
 * 的是**进入菜单之前**最后一个可编辑焦点的状态，并且焦点移进标题栏 / 下拉本身时不改变它。
 *
 * 状态同时通过 `desktop:editable-focus` 报给主进程：菜单打开前会重新读一次窗口实态
 * （见 useDesktopWindowState 的约束 2），两边必须同源，否则"显示可点"和"点了有效"会是两回事。
 *
 * 另外暴露 `restoreEditableFocus()`：编辑命令（webContents.undo/cut/copy/paste/selectAll）
 * 只作用于**焦点元素**，而点自绘菜单项会把 DOM 焦点移到标题栏——执行编辑命令前必须把
 * 焦点还给原来那个输入框，否则菜单项虽可点、命令却是 no-op（#34 交叉复核 O3）。
 */
import { useCallback, useEffect, useRef } from "react";
import type { DesktopShellBridge } from "./desktopShellBridge";

/** 标题栏与它的下拉（下拉 portal 到 body，所以是两个选择器）。 */
const MENU_HOST_SELECTOR = ".app-titlebar, .app-titlebar-menu-dropdown, .app-titlebar-menu-submenu";

/**
 * 可编辑焦点判定。
 *
 * 比 ai-polish 的 `isEditableElement` 宽：这里只关心"撤销 / 重做能不能落地"，不做
 * 敏感字段排除（密码框里同样有可撤销的输入），也不要求有选区。
 */
export function isEditableFocusTarget(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLInputElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  return element.getAttribute("contenteditable") === "true";
}

function isInsideMenu(element: Element | null): boolean {
  if (!element || typeof element.closest !== "function") return false;
  try {
    return Boolean(element.closest(MENU_HOST_SELECTOR));
  } catch {
    return false;
  }
}

export interface DesktopEditableFocusHandle {
  /**
   * 把焦点还给最近一次可编辑焦点；没有可还的目标（已卸载 / 已不可编辑）时返回 false。
   * 仅供"执行编辑类菜单动作前"调用，见文件头的 O3 说明。
   */
  restoreEditableFocus: () => boolean;
}

export function useDesktopEditableFocus(
  bridge: DesktopShellBridge,
  onChange: (editable: boolean) => void,
): DesktopEditableFocusHandle {
  const lastEditableRef = useRef<HTMLElement | null>(null);

  const restoreEditableFocus = useCallback((): boolean => {
    const element = lastEditableRef.current;
    if (!element || !element.isConnected) return false;
    if (!isEditableFocusTarget(element)) return false;
    element.focus({ preventScroll: true });
    return true;
  }, []);

  useEffect(() => {
    let current: boolean | null = null;
    const remember = (target: Element | null) => {
      if (isEditableFocusTarget(target)) lastEditableRef.current = target as HTMLElement;
    };
    const report = (editable: boolean) => {
      if (editable === current) return;
      current = editable;
      onChange(editable);
      bridge.setEditableFocus?.(editable);
    };
    // 挂载时若焦点已经在可编辑区里（例如从弹窗返回），别漏掉这一份。
    remember(document.activeElement);
    report(isEditableFocusTarget(document.activeElement));

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null;
      if (isInsideMenu(target)) return;
      remember(target);
      report(isEditableFocusTarget(target));
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Element | null;
      // 焦点移进菜单：保留上一次的判断；在两个可编辑区之间移动：交给随后的 focusin。
      if (isInsideMenu(next) || isEditableFocusTarget(next)) return;
      report(false);
    };
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, [bridge, onChange]);

  return { restoreEditableFocus };
}
