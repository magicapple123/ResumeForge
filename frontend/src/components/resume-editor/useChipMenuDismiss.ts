// SPDX-License-Identifier: Apache-2.0
/**
 * #6：字段右键菜单的完整关闭路径。
 *
 * antd Dropdown 在 `trigger={[]}` + 受控 `open` 下**只**处理菜单自身的键盘/点选，
 * 不会替我们关"点界面空白"（实测：左栏/预览区/顶栏点一圈，菜单仍是 1 份）。这里补齐：
 *
 * - **点空白**：window `pointerdown` 捕获阶段判断点击是否落在菜单自身（menu 是 portal
 *   到 body 的，所以必须按选择器排除，不能用 contains）；
 * - **滚动 / resize / window blur**：浮层锚点滚走就会错位，直接关掉（下次右键在新的
 *   鼠标处重开）。
 *
 * 右键另一个 chip 时也是同一条路径：第一次 `pointerdown`（右键按下）先关旧菜单，随后的
 * `contextmenu` 再按新坐标重开——重开会重新对齐锚点，菜单因此跟到新鼠标位置而不是停在
 * 旧位置。
 *
 * `closeOnOutsidePointer` 默认关：`ChipStylePopover` 复用本 hook 只想要"滚动/resize/
 * 失焦"这一半语义（浮层里的 antd Select 弹层也 portal 到 body，按 pointerdown 关会把
 * 正在选颜色的操作打断），它显式不打开这一项。
 */

import { useEffect } from "react";

/** 菜单/浮层自身（portal 到 body 的容器）——点它们不算"点空白"。 */
const MENU_SURFACES = [
  ".ant-dropdown",
  ".ant-dropdown-menu",
  ".ant-select-dropdown",
  ".ant-picker-dropdown",
  ".document-chip-menu-anchor",
];

export interface ChipMenuDismissOptions {
  /** true = 在菜单外任意 `pointerdown` 时关闭（右键菜单需要，浮层不需要）。 */
  closeOnOutsidePointer?: boolean;
}

export function useChipMenuDismiss(
  open: boolean,
  onClose: () => void,
  options: ChipMenuDismissOptions = {},
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
