// SPDX-License-Identifier: Apache-2.0
/**
 * 右键菜单/浮层的统一关闭路径：滚动（捕获）、resize、窗口失焦、以及可选的"点空白"。
 *
 * 从 `components/resume-editor/useChipMenuDismiss.ts` 提升而来（2026-11-04）：那份实现
 * 同时服务字段 chip 菜单、页签菜单与排版浮层，问题 25 起由四个右键实现共用。
 *
 * `closeOnOutsidePointer` 默认关（**必须保留这个默认**）：`ChipStylePopover` 复用本 hook
 * 只想要"滚动/resize/失焦"这一半语义——浮层里的 antd Select 弹层也 portal 到 body，
 * 按 pointerdown 关会把正在选颜色的操作打断。
 *
 * 菜单是 portal 到 body 的，所以"点自己不算点空白"只能按选择器排除，不能用 contains。
 */

import { useEffect } from "react";

/** 菜单/浮层自身（portal 到 body 的容器）——点它们不算"点空白"。 */
const MENU_SURFACES = [
  ".rf-ctx-menu",
  ".ant-dropdown",
  ".ant-dropdown-menu",
  ".ant-select-dropdown",
  ".ant-picker-dropdown",
  ".document-chip-menu-anchor",
];

export interface MenuDismissOptions {
  /** true = 在菜单外任意 `pointerdown` 时关闭（右键菜单需要，浮层不需要）。 */
  closeOnOutsidePointer?: boolean;
}

export function useMenuDismiss(
  open: boolean,
  onClose: () => void,
  options: MenuDismissOptions = {},
) {
  const { closeOnOutsidePointer = false } = options;
  useEffect(() => {
    if (!open) return;
    const close = () => onClose();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(MENU_SURFACES.join(","))) return;
      close();
    };
    // capture：内部容器（.document-editor 等）的滚动也要关——scroll 不冒泡。
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    if (closeOnOutsidePointer) window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      if (closeOnOutsidePointer) window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [closeOnOutsidePointer, open, onClose]);
}
