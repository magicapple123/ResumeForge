// SPDX-License-Identifier: Apache-2.0
/**
 * 标题栏下拉菜单（问题清单 §19；从 DesktopTitleBar.tsx 拆出来的）。
 *
 * 拆出去的理由只有一条：DesktopTitleBar.tsx 已经贴着 500 行预算，而 #34 还要往里
 * 加置顶勾选、撤销置灰、重新加载、复制诊断、导出子菜单这些条目。下拉的渲染与"下拉
 * 内部"的键盘导航是自洽的一块，容器只负责"开哪个、在哪开、点了做什么"。
 *
 * 这里只做展示与列表内导航：条目是否禁用 / 是否勾选 / 快捷键文案全部由 props 决定，
 * 动作交回容器。这样"置灰只看焦点在不在可编辑区"这类规则留在模型与容器里，不在渲染层再判。
 *
 * #34C 起的子菜单（「文件 → 导出」）**渲染在同一个下拉容器内**（绝对定位到右侧），
 * 不另开 portal：点外关闭、焦点归属、滚动关闭都由容器那一层的 contains 判断自然覆盖。
 */
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { layer } from "../../theme/tokens";
import {
  desktopMenuItemChecked,
  desktopMenuItemLabelKey,
  desktopMenuItemShortcut,
  type DesktopMenu,
  type DesktopMenuItem,
} from "./desktopMenuModel";

/** 条目选择器：容器与下拉内部都用它做焦点导航（统一一处，避免两套拼写）。 */
export const MENU_ITEM_SELECTOR = ".app-titlebar-menu-item";

export interface DropdownPosition {
  left: number;
  top: number;
}

interface Props {
  menu: DesktopMenu;
  position: DropdownPosition;
  isMac: boolean;
  maximized: boolean;
  alwaysOnTop: boolean;
  editableFocus: boolean;
  dropdownRef: RefObject<HTMLDivElement | null>;
  onRun: (item: DesktopMenuItem) => void;
  onSwitchMenu: (step: number) => void;
  /** Esc：收起并把焦点还给触发按钮。 */
  onEscape: () => void;
  /** Tab：收起菜单（焦点继续走浏览器默认顺序）。 */
  onDismiss: () => void;
}

function itemDisabled(item: DesktopMenuItem, editableFocus: boolean): boolean {
  return Boolean(item.requiresEditableFocus) && !editableFocus;
}

/** 一个列表容器里可聚焦的条目（跳过禁用项：禁用的按钮不该出现在 Tab / 方向键顺序里）。 */
function focusableItems(container: HTMLElement | null): HTMLButtonElement[] {
  const all = Array.from(container?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR) ?? []);
  return all.filter((item) => !item.disabled);
}

function MenuItemButton({
  item,
  isMac,
  maximized,
  checked,
  disabled,
  onRun,
}: {
  item: DesktopMenuItem;
  isMac: boolean;
  maximized: boolean;
  checked: boolean;
  disabled: boolean;
  onRun: (item: DesktopMenuItem) => void;
}) {
  const label = t(desktopMenuItemLabelKey(item, maximized));
  const shortcut = desktopMenuItemShortcut(item, isMac);
  return (
    <button
      type="button"
      role={item.checkbox ? "menuitemcheckbox" : "menuitem"}
      className="app-titlebar-menu-item"
      data-menu-item-id={item.key}
      aria-label={label}
      aria-checked={item.checkbox ? checked : undefined}
      // 禁用语义只传 true 或 undefined（显式 false 会短路组件级 disabled）。
      disabled={disabled || undefined}
      // 自绘菜单项默认会在鼠标按下时抢走 DOM 焦点；编辑命令作用在焦点元素上，
      // 这里保住焦点（真正的"还焦点"由容器在编辑类动作前做，见 focusEditableBeforeRun）。
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onRun(item)}
    >
      <span className="app-titlebar-menu-label">
        {item.checkbox ? (
          // 复选框语义由 role + aria-checked 承载；这里只画一个固定宽度的对勾。
          <span className="app-titlebar-menu-check" aria-hidden="true">
            {checked ? "✓" : ""}
          </span>
        ) : null}
        {label}
      </span>
      {shortcut ? <span className="app-titlebar-menu-shortcut">{shortcut}</span> : null}
    </button>
  );
}

export default function DesktopMenuDropdown({
  menu,
  position,
  isMac,
  maximized,
  alwaysOnTop,
  editableFocus,
  dropdownRef,
  onRun,
  onSwitchMenu,
  onEscape,
  onDismiss,
}: Props) {
  useLocale();
  const listRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [openSubmenuKey, setOpenSubmenuKey] = useState<string | null>(null);
  /** 键盘打开子菜单时把焦点送进第一项；鼠标悬停展开不抢焦点。 */
  const focusSubmenuOnOpenRef = useRef(false);

  const submenuParent = menu.items.find(
    (item) => item.key === openSubmenuKey && item.children && item.children.length > 0,
  );

  useLayoutEffect(() => {
    if (!submenuParent || !focusSubmenuOnOpenRef.current) return;
    focusSubmenuOnOpenRef.current = false;
    focusableItems(submenuRef.current)[0]?.focus({ preventScroll: true });
  }, [submenuParent]);

  const closeSubmenu = () => {
    setOpenSubmenuKey(null);
  };

  /** 键盘：把焦点送回子菜单的父项。 */
  const focusSubmenuParent = (parentKey: string) => {
    const parent = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-menu-item-id="${parentKey}"]`,
    );
    parent?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const active = document.activeElement as HTMLElement | null;
    const inSubmenu = Boolean(submenuRef.current?.contains(active));
    const container = inSubmenu ? submenuRef.current : listRef.current;
    const items = focusableItems(container);
    const current = items.findIndex((item) => item === active);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (items.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next =
          current < 0
            ? step > 0
              ? 0
              : items.length - 1
            : (current + step + items.length) % items.length;
        items[next].focus({ preventScroll: true });
        return;
      }
      case "Home":
      case "End": {
        event.preventDefault();
        items[event.key === "Home" ? 0 : items.length - 1]?.focus({ preventScroll: true });
        return;
      }
      case "ArrowRight": {
        event.preventDefault();
        // 主列表：子菜单父项 → 展开并进第一项；其余 → 切到右边的一级菜单（既有行为）。
        if (!inSubmenu) {
          const activeItem = menu.items.find(
            (item) => item.key === active?.getAttribute("data-menu-item-id"),
          );
          if (activeItem?.children?.length) {
            focusSubmenuOnOpenRef.current = true;
            setOpenSubmenuKey(activeItem.key);
            return;
          }
        }
        onSwitchMenu(1);
        return;
      }
      case "ArrowLeft": {
        event.preventDefault();
        if (inSubmenu) {
          const parentKey = openSubmenuKey;
          closeSubmenu();
          if (parentKey) focusSubmenuParent(parentKey);
          return;
        }
        onSwitchMenu(-1);
        return;
      }
      case "Escape":
        event.preventDefault();
        if (inSubmenu) {
          const parentKey = openSubmenuKey;
          closeSubmenu();
          if (parentKey) focusSubmenuParent(parentKey);
          return;
        }
        if (openSubmenuKey) {
          closeSubmenu();
          return;
        }
        onEscape();
        return;
      case "Tab":
        onDismiss();
        return;
      default:
    }
  };

  const renderItem = (item: DesktopMenuItem) => {
    // 子菜单父项：不执行动作，展开 children；点击/悬停/→ 都可打开。
    if (item.children && item.children.length > 0) {
      const open = openSubmenuKey === item.key;
      const label = t(desktopMenuItemLabelKey(item, maximized));
      return (
        <div
          key={item.key}
          className="app-titlebar-menu-item-wrap"
          onMouseEnter={() => setOpenSubmenuKey(item.key)}
        >
          <button
            type="button"
            role="menuitem"
            className="app-titlebar-menu-item"
            data-menu-item-id={item.key}
            data-submenu-open={open ? "true" : "false"}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              // detail === 0 = 键盘触发的 click（Enter/空格）：展开后把焦点交给第一项。
              focusSubmenuOnOpenRef.current = event.detail === 0;
              setOpenSubmenuKey((previous) => (previous === item.key ? null : item.key));
            }}
          >
            <span className="app-titlebar-menu-label">{label}</span>
            <span className="app-titlebar-menu-submenu-arrow" aria-hidden="true">
              ▸
            </span>
          </button>
          {open ? (
            <div
              ref={submenuRef}
              className="app-titlebar-menu-submenu"
              role="menu"
              aria-label={label}
            >
              {item.children.map((child) => (
                <MenuItemButton
                  key={child.key}
                  item={child}
                  isMac={isMac}
                  maximized={maximized}
                  checked={desktopMenuItemChecked(child, { alwaysOnTop })}
                  disabled={itemDisabled(child, editableFocus)}
                  onRun={onRun}
                />
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div key={item.key} className="app-titlebar-menu-item-wrap" onMouseEnter={closeSubmenu}>
        <MenuItemButton
          item={item}
          isMac={isMac}
          maximized={maximized}
          checked={desktopMenuItemChecked(item, { alwaysOnTop })}
          disabled={itemDisabled(item, editableFocus)}
          onRun={onRun}
        />
      </div>
    );
  };

  return createPortal(
    <div
      ref={dropdownRef}
      id={`desktop-titlebar-menubar-${menu.id}`}
      className="app-titlebar-menu-dropdown"
      role="menu"
      aria-label={t(menu.labelKey)}
      style={{ left: position.left, top: position.top, zIndex: layer.popupBase }}
      onKeyDown={handleKeyDown}
    >
      <div ref={listRef} className="app-titlebar-menu-list" role="none">
        {menu.items.map((item) => (
          <Fragment key={item.key}>
            {item.separatorBefore ? (
              <div className="app-titlebar-menu-separator" role="separator" />
            ) : null}
            {renderItem(item)}
          </Fragment>
        ))}
      </div>
    </div>,
    document.body,
  );
}
