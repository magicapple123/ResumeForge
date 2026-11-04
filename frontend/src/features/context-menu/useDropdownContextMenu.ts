// SPDX-License-Identifier: Apache-2.0
/**
 * 行级右键菜单的受控状态（问题 25）：指针打开贴鼠标、键盘打开回落到元素锚点。
 *
 * 为什么需要这个 hook：antd v6 的 `Dropdown` 在 `trigger` 含 `contextMenu` 时**强制**
 * `alignPoint`（`antd/es/dropdown/dropdown.js` 里由 trigger 推导，不接受 prop 覆盖），
 * 键盘打开时没有鼠标坐标，会拿"上一次鼠标移动的位置"当锚点，菜单可能飞到屏幕另一头。
 * 受控打开时把 `trigger` 临时切成空数组即可退回元素锚点——这是唯一不改 antd 源码的路径。
 *
 * 另外两条：`autoFocus` 只在键盘打开时给（指针打开不该出现首项聚焦底色），
 * 滚动/resize/失焦统一走 `useMenuDismiss`（antd 只跟随重定位，不关闭）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ContextMenuSource } from "./ContextMenuSurface";
import { useMenuDismiss } from "./useMenuDismiss";
import { hasActiveTextSelection } from "./selectionGuard";

export interface DropdownContextMenuProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  trigger: ["contextMenu"] | [];
  autoFocus: boolean;
}

export interface DropdownContextMenu {
  open: boolean;
  source: ContextMenuSource;
  close: () => void;
  /** 挂在触发元素的 `onKeyDown` 上：Shift+F10 / 菜单键打开（Windows 键盘右键）。 */
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** 展开给 antd `<Dropdown {...dropdownProps}>`。 */
  dropdownProps: DropdownContextMenuProps;
}

export function useDropdownContextMenu(): DropdownContextMenu {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<ContextMenuSource>("pointer");
  /** 键盘打开时的那一行：关闭后要把焦点还给它。 */
  const triggerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // 关掉之后回到指针模式：下一次右键仍由 antd 的 contextMenu trigger 接管。
    setSource("pointer");
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (!trigger) return;
    /**
     * 等一拍再归还焦点：按 Esc 时 rc-menu 会在同一拍把焦点挪回菜单项，
     * 而菜单随即卸载——不等这一拍，焦点就跟着那份 DOM 一起掉到 body 上。
     * 只有"焦点还在菜单里/已经丢到 body"时才抢回来，不干扰点菜单项打开的弹窗。
     */
    window.setTimeout(() => {
      if (!trigger.isConnected) return;
      const active = document.activeElement;
      const inMenu = active instanceof Element && active.closest(".ant-dropdown") !== null;
      if (active === null || active === document.body || inMenu) {
        trigger.focus({ preventScroll: true });
      }
    }, 0);
  }, []);

  useMenuDismiss(open, close, { closeOnOutsidePointer: true });

  /**
   * Esc 自己接：rc-menu 在关闭的同一拍会把焦点挪回菜单项，菜单随即卸载——焦点就这样
   * 掉到 body 上。捕获阶段先关，再按 `close()` 里的归还逻辑把焦点还回触发元素。
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close, open]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    event.stopPropagation();
    triggerRef.current = event.currentTarget;
    setSource("keyboard");
    setOpen(true);
  }, []);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        /**
         * 已经选中了文字：这次右键属于"处理这段文字"（剪切/复制/AI 润色），
         * 行/字段菜单必须让位——否则两套监听各开一份，屏幕上就是两张叠着的卡片
         * （2026-11-04 用户实测）。键盘打开不走这里，不受影响。
         */
        if (hasActiveTextSelection()) {
          setOpen(false);
          return;
        }
        // 由指针触发：贴鼠标（antd 的 alignPoint 在 contextMenu trigger 下恒开）。
        setSource("pointer");
        setOpen(true);
        return;
      }
      close();
    },
    [close],
  );

  return {
    open,
    source,
    close,
    handleKeyDown,
    dropdownProps: {
      open,
      onOpenChange,
      trigger: source === "keyboard" ? [] : ["contextMenu"],
      autoFocus: source === "keyboard",
    },
  };
}
