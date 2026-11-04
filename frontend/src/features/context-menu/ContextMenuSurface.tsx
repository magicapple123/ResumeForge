// SPDX-License-Identifier: Apache-2.0
/**
 * 统一右键浮层：portal + `role="menu"` + 方向键循环 + Esc + 打开即聚焦 + 关闭归还焦点。
 *
 * 收敛来源（问题 25）：`resume-preview/BoldContextMenu` 与 `ai-polish/SelectionContextMenu`
 * 各自手写过一遍同样的 `role=menu` / 方向键 / keepSelection / document 级关闭，此处合成一份；
 * `QueueTable` 的坐标式菜单也走这里（原来裸 `left/top` + 写死 z-index 1050/1060）。
 *
 * 三条容易被改坏的约定：
 * 1. **落位贴指针并夹进视口**（`positioning.placeMenu`），不越出四个角；
 * 2. **来源决定首项是否聚焦**：指针打开时焦点落在菜单容器（不出现首项底色），键盘打开时
 *    落在第一个可用项——否则菜单键打开后方向键/Enter 无处可去；
 * 3. **`keepSelection` 默认关**：只有"要对选区做事"的菜单（加粗、剪贴板）才打开它，
 *    因为 `mousedown.preventDefault()` 会挡掉正常按钮的按下态。
 *
 * 子菜单刻意不支持（问题清单「刻意不做」）：传入 `children` 时按"分组标题 + 平铺子项"渲染，
 * 现有的行级子菜单仍走 antd Dropdown。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { RowMenuItem } from "../../components/common/rowActionMenu";
import { layer } from "../../theme/tokens";
import { placeMenu, type MenuSize } from "./positioning";
import { useMenuDismiss } from "./useMenuDismiss";

export type ContextMenuSource = "pointer" | "keyboard";

export interface ContextMenuSurfaceProps {
  /** 指针位置（视口坐标）。 */
  x: number;
  y: number;
  items: RowMenuItem[];
  onClose: () => void;
  /** 菜单的无障碍名称（走 `t()`，调用方给）。 */
  ariaLabel: string;
  /** 打开来源：决定首项是否聚焦（键盘打开才有聚焦底色）。 */
  source?: ContextMenuSource;
  /** 点击项时拦住 `mousedown` 默认行为，保住文本选区（只有选区类菜单需要）。 */
  keepSelection?: boolean;
  /** 层级，默认与 AI 润色浮层同层（盖住承载输入框的弹窗）。 */
  zIndex?: number;
}

/** 量不到时的兜底尺寸：132px 起、每项 32px + 上下 8px 内边距。 */
function estimateSize(count: number): MenuSize {
  return { width: 176, height: count * 32 + 8 };
}

export function ContextMenuSurface({
  x,
  y,
  items,
  onClose,
  ariaLabel,
  source = "pointer",
  keepSelection = false,
  zIndex = layer.aiPolish,
}: ContextMenuSurfaceProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** 打开前焦点在哪：关闭时只有焦点掉到 body 才还回去（别抢走刚打开的弹窗）。 */
  const restoreRef = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState<MenuSize>(() => estimateSize(items.length));

  useMenuDismiss(true, onClose, { closeOnOutsidePointer: true });

  // Esc 用 window 级捕获监听：菜单容器不一定持有焦点（点开的路径焦点可能在别处），
  // 只在容器上监听会让"Esc 关不掉"。捕获阶段还能同时覆盖 `keyDown(document)` 与
  // `keyDown(window)` 两种派发方式（旧实现分别用过这两种）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    // jsdom 里量到 0：保留估算值，定位仍可断言。
    if (rect && rect.width > 0 && rect.height > 0) {
      setSize({ width: rect.width, height: rect.height });
    }
  }, [items.length]);

  useLayoutEffect(() => {
    const menuNode = menuRef.current;
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = menuNode?.querySelector<HTMLButtonElement>(".rf-ctx-menu-item:not([disabled])");
    const target = source === "keyboard" && first ? first : menuNode;
    target?.focus({ preventScroll: true });
    return () => {
      const restoreTo = restoreRef.current;
      if (!restoreTo || !restoreTo.isConnected) return;
      const active = document.activeElement;
      // 只有"焦点丢在 body 上"或"焦点还在即将被移除的菜单里"才归还：
      // 点菜单项打开的弹窗不该被抢走焦点。
      const insideMenu = active instanceof Node && menuNode?.contains(active);
      if (active === null || active === document.body || insideMenu) {
        restoreTo.focus({ preventScroll: true });
      }
    };
  }, [source]);

  const focusables = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(".rf-ctx-menu-item:not([disabled])") ??
          [],
      ),
    [],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Tab") {
        // 焦点移出菜单就等同于"离开"，不加这一条会把菜单留在原地。
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const nodes = focusables();
      if (nodes.length === 0) return;
      const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next =
        current < 0
          ? step > 0
            ? 0
            : nodes.length - 1
          : (current + step + nodes.length) % nodes.length;
      nodes[next].focus();
    },
    [focusables, onClose],
  );

  const keepSelectionOnMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (keepSelection) event.preventDefault();
    },
    [keepSelection],
  );

  const placement = placeMenu({ x, y }, size);

  const renderAction = (item: RowMenuItem) => {
    if (item.type === "divider") {
      return <div key={item.key} role="separator" className="rf-ctx-menu-separator" />;
    }
    if (item.children && item.children.length > 0) {
      // 不画多级子菜单：分组标题 + 平铺子项，行为等价且不引入二级键盘路径。
      return (
        <div key={item.key} role="presentation">
          <div className="rf-ctx-menu-group-label">{item.label}</div>
          {item.children.map(renderAction)}
        </div>
      );
    }
    return (
      <button
        key={item.key}
        type="button"
        role="menuitem"
        className={`rf-ctx-menu-item${item.danger ? " is-danger" : ""}`}
        disabled={item.disabled || undefined}
        onMouseDown={keepSelectionOnMouseDown}
        onClick={() => {
          if (item.disabled) return;
          item.onClick?.();
          onClose();
        }}
      >
        {item.icon ? (
          <span className="rf-ctx-menu-icon" aria-hidden="true">
            {item.icon}
          </span>
        ) : null}
        <span className="rf-ctx-menu-label">{item.label}</span>
      </button>
    );
  };

  return createPortal(
    <div
      ref={menuRef}
      className="rf-ctx-menu"
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{ left: placement.left, top: placement.top, zIndex }}
      onMouseDown={keepSelectionOnMouseDown}
      onKeyDown={handleKeyDown}
    >
      {items.map(renderAction)}
    </div>,
    document.body,
  );
}

export default ContextMenuSurface;
