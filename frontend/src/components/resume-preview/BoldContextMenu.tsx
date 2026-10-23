// SPDX-License-Identifier: Apache-2.0
/**
 * 纸面上「选中一小段文字 → 右键」的菜单：加粗 / 取消加粗、分隔线、编辑这一栏。
 *
 * ## 为什么自己画一份，而不是放行原生菜单
 *
 * 纸面是后端渲染的 HTML，浏览器原生右键菜单里没有任何"改内容"的入口；而用户此刻的意图
 * 极其明确——把这段字加粗。原生菜单里能做的（复制、检查元素）对简历编辑没有价值。
 *
 * ## 三条不能省的细节
 *
 * 1. **容器与每个按钮都拦掉 `mousedown` 的默认行为**：否则按下的一瞬间选区就没了，
 *    而"要加粗的那一段"正是靠选区表达的（`SelectionContextMenu` 踩过同一个坑）；
 * 2. **关闭时机交给 document 级监听**（菜单外按下、Esc、滚动 / 缩放、窗口失焦），
 *    不用 `onBlur`——焦点会移到别处，那不代表用户想关菜单；
 * 3. **打开即 focus**：Esc 才有落点，读屏用户也才知道弹出了一个菜单。
 *
 * 样式类复用 `features/ai-polish` 那一套（`rf-ai-polish-menu*`）：两个菜单是同一类浮层，
 * 各写一套 CSS 迟早会出现"同一个应用里两种右键菜单"。
 */
import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { layer } from "../../theme/tokens";
import { t } from "../../i18n";

/** 调用方（`ResumePreview`）通过这一条 import 同时拿到菜单与契约类型，省一行行数预算。 */
export type { RichTextEditAdapter } from "./richText";

export interface BoldContextMenuProps {
  /** 菜单左上角（父页面视口坐标），已由 `menuPoint` 夹进可视区。 */
  x: number;
  y: number;
  /** 当前选区是否整段已加粗：决定第一项显示「加粗」还是「取消加粗」。 */
  isBold: boolean;
  /** 切换加粗（写入新的源串，并由宿主把内容标脏）。 */
  onToggle: () => void;
  /** 等价于左键点击那一栏：打开中栏/弹窗里对应的输入框。 */
  onPick: () => void;
  /** 关掉菜单（不改变任何内容）。 */
  onClose: () => void;
}

export default function BoldContextMenu({
  x,
  y,
  isBold,
  onToggle,
  onPick,
  onClose,
}: BoldContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target;
      if (node instanceof Node && menuRef.current?.contains(node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    const onViewportChange = () => onClose();

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    // 捕获阶段：iframe 之外的容器、弹窗自己的滚动同样会挪走菜单，不能只监听 window。
    document.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("blur", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("blur", onViewportChange);
    };
  }, [onClose]);

  // 点按钮同样不许动选区：`preventDefault` 把「按下鼠标 → 清选区」这一步堵掉。
  const keepSelection = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next =
      current < 0
        ? step > 0
          ? 0
          : items.length - 1
        : (current + step + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div
      ref={menuRef}
      className="rf-ai-polish-menu"
      role="menu"
      aria-label={t("rich.menu.label")}
      tabIndex={-1}
      style={{ left: x, top: y, zIndex: layer.aiPolish }}
      onMouseDown={keepSelection}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        role="menuitem"
        className="rf-ai-polish-menu-item"
        onMouseDown={keepSelection}
        onClick={onToggle}
      >
        {isBold ? t("rich.menu.unbold") : t("rich.menu.bold")}
      </button>
      <div className="rf-ai-polish-menu-separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="rf-ai-polish-menu-item"
        onMouseDown={keepSelection}
        onClick={onPick}
      >
        {t("rich.menu.edit")}
      </button>
    </div>
  );
}
