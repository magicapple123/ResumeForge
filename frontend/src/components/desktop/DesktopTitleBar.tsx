// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面自绘标题栏（问题清单 §19）。
 *
 * 32px 高的标题栏住在应用根（#root > .app-shell 之上），左侧六个菜单，右侧三颗窗口
 * 按钮由系统覆盖层（titleBarOverlay）绘制——本组件不画按钮、也不接管系统贴靠布局。
 *
 * 几条容易被"看起来没问题"掩盖的约束：
 *  1. 标题栏整体 -webkit-app-region: drag，菜单容器与下拉必须 no-drag（漏一个整条
 *     标题栏点不动，且极难排查）；
 *  2. 菜单是自绘的：点击展开 + 已展开时悬停切换、Esc / 点外部 / 失焦 / 滚动关闭；
 *  3. 键盘可达性只靠 Alt → 左右 → 上下 → Enter（**不做 Alt+F 字母跳转**，见 §19.2）；
 *  4. 主题切换要把实际生效的深浅色告诉主进程，覆盖层按钮颜色跟着变；
 *  5. 全屏时隐藏标题栏，但组件保持挂载（否则收不到退出全屏的推送）。
 *
 * 动作全部通过 desktopShellBridge 的固定动作 id 交给主进程；渲染层不直接碰 Electron。
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import AboutDesktopDialog from "./AboutDesktopDialog";
import {
  DESKTOP_MENUS,
  desktopMenuItemLabelKey,
  desktopMenuIndex,
  type DesktopMenu,
  type DesktopMenuItem,
} from "./desktopMenuModel";
import {
  getDesktopShellBridge,
  openUserGuideFromMenu,
  requestDesktopQuit,
  type DesktopShellBridge,
  type DesktopWindowState,
} from "./desktopShellBridge";
import { useDesktopMenuShortcuts } from "./useDesktopMenuShortcuts";
import { useResolvedTheme } from "../../features/theme/themeStore";
import { formatShortcut } from "../../features/shortcuts/matchShortcut";
import { layer } from "../../theme/tokens";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import "../../styles/desktop-titlebar.css";

const MENUBAR_ID = "desktop-titlebar-menubar";
const ITEM_SELECTOR = ".app-titlebar-menu-item";

interface DropdownPosition {
  left: number;
  top: number;
}

/** 加速键提示文本：F11 用原样文本，其余交给 formatShortcut 按平台排版。 */
function shortcutLabel(item: DesktopMenuItem, isMac: boolean): string {
  if (item.shortcutText) return item.shortcutText;
  return item.shortcut ? formatShortcut(item.shortcut, { mac: isMac }) : "";
}

/** 外层只做"是不是桌面壳"的分流：浏览器里不挂任何 hook、不渲染任何元素。 */
export default function DesktopTitleBar() {
  const bridge = getDesktopShellBridge();
  if (!bridge) return null;
  return <DesktopTitleBarInner bridge={bridge} />;
}

function DesktopTitleBarInner({ bridge }: { bridge: DesktopShellBridge }) {
  useLocale();
  const navigate = useNavigate();
  const resolvedTheme = useResolvedTheme();
  const isMac = bridge.platform === "darwin";
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [windowState, setWindowState] = useState<DesktopWindowState>({
    maximized: false,
    fullscreen: false,
  });
  const [dropdown, setDropdown] = useState<DropdownPosition | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const focusMenuOnOpenRef = useRef(false);

  const openMenu = openMenuId
    ? (DESKTOP_MENUS.find((menu) => menu.id === openMenuId) ?? null)
    : null;

  // 主题同步：标题栏覆盖层由主进程绘制，深浅色切换必须显式告诉它。
  useEffect(() => {
    bridge.setTheme?.(resolvedTheme);
  }, [bridge, resolvedTheme]);

  // 窗口状态：初始快照 + 主进程推送（最大化/还原文案、全屏隐藏标题栏都读它）。
  useEffect(() => {
    let active = true;
    const apply = (state?: DesktopWindowState | null) => {
      if (!active || !state) return;
      setWindowState(state);
      // 进入全屏时收起下拉：标题栏马上要被隐藏，留着菜单没有意义。
      if (state.fullscreen) setOpenMenuId(null);
    };
    const pending = bridge.getWindowState?.();
    if (pending) void pending.then(apply).catch(() => undefined);
    bridge.onWindowState?.(apply);
    return () => {
      active = false;
    };
  }, [bridge]);

  // 关闭：Esc / 点菜单外 / 滚动内容区 / 窗口失焦（§19.5-2）。
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (barRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as Node | null;
      // 焦点还在菜单里时交给 React 的键盘处理器：那里负责把焦点还给触发按钮。
      if (target && (barRef.current?.contains(target) || dropdownRef.current?.contains(target)))
        return;
      event.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [openMenuId]);

  // Alt：把焦点交给菜单栏；已聚焦时再按一次离开（§19.5-3，不做字母跳转）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Alt" || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      const bar = barRef.current;
      const active = document.activeElement as HTMLElement | null;
      if (bar && active && bar.contains(active)) {
        setOpenMenuId(null);
        setFocusIndex(-1);
        const restore = restoreFocusRef.current;
        if (restore && restore.isConnected) restore.focus();
        else active.blur();
        return;
      }
      restoreFocusRef.current = active;
      setFocusIndex(0);
      triggerRefs.current[0]?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // 加速键：文件 (Ctrl+N / Ctrl+O) 与视图 (Ctrl+± / Ctrl+0 / F11)；编辑类交给 Chromium。
  useDesktopMenuShortcuts({ bridge, isMac, navigate });

  // 下拉定位：贴着触发按钮下沿并夹进视口（jsdom 量到 0 时按 0 处理，不影响断言）。
  // 这是"把浏览器量出来的矩形同步到 React 状态"的典型场景；菜单关闭时 stale 的
  // dropdown 不会被渲染（openMenu 为 null），所以关闭分支不需要额外清状态。
  useLayoutEffect(() => {
    if (!openMenuId) return;
    const index = desktopMenuIndex(openMenuId);
    const trigger = index >= 0 ? triggerRefs.current[index] : null;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setDropdown({ left: Math.max(8, rect.left), top: rect.bottom + 2 });
  }, [openMenuId]);

  // 键盘打开时把焦点送进第一项；鼠标打开不抢焦点。
  useLayoutEffect(() => {
    if (!dropdown || !focusMenuOnOpenRef.current) return;
    focusMenuOnOpenRef.current = false;
    dropdownRef.current
      ?.querySelector<HTMLButtonElement>(ITEM_SELECTOR)
      ?.focus({ preventScroll: true });
  }, [dropdown]);

  const focusTrigger = useCallback((index: number) => {
    const total = DESKTOP_MENUS.length;
    const next = (index + total) % total;
    setFocusIndex(next);
    triggerRefs.current[next]?.focus({ preventScroll: true });
  }, []);

  const closeAndFocusTrigger = useCallback(() => {
    const index = openMenuId ? desktopMenuIndex(openMenuId) : -1;
    setOpenMenuId(null);
    if (index < 0) return;
    setFocusIndex(index);
    triggerRefs.current[index]?.focus({ preventScroll: true });
  }, [openMenuId]);

  const switchMenu = useCallback(
    (step: number) => {
      const current = openMenuId ? desktopMenuIndex(openMenuId) : 0;
      const from = current >= 0 ? current : 0;
      const next = (from + step + DESKTOP_MENUS.length) % DESKTOP_MENUS.length;
      const target = DESKTOP_MENUS[next];
      setFocusIndex(next);
      if (target.opensDialog) {
        setOpenMenuId(null);
        return;
      }
      focusMenuOnOpenRef.current = true;
      setOpenMenuId(target.id);
    },
    [openMenuId],
  );

  const runItem = useCallback(
    (item: DesktopMenuItem) => {
      setOpenMenuId(null);
      if (item.kind === "navigate" && item.path) {
        navigate(item.path);
        return;
      }
      if (item.kind === "ipc" && item.ipcAction) {
        const pending = bridge.menuAction?.(item.ipcAction);
        if (pending) void pending.catch(() => undefined);
        return;
      }
      if (item.kind === "quit") {
        requestDesktopQuit();
        return;
      }
      if (item.kind === "open-guide") openUserGuideFromMenu();
    },
    [bridge, navigate],
  );

  const toggleTrigger = (menu: DesktopMenu, keyboard: boolean) => {
    if (menu.opensDialog) {
      setOpenMenuId(null);
      setAboutOpen(true);
      return;
    }
    if (openMenuId === menu.id) {
      setOpenMenuId(null);
      return;
    }
    focusMenuOnOpenRef.current = keyboard;
    setOpenMenuId(menu.id);
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    const menu = DESKTOP_MENUS[index];
    switch (event.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        if (openMenuId && !menu.opensDialog) {
          switchMenu(step);
        } else {
          focusTrigger(index + step);
        }
        return;
      }
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        setFocusIndex(index);
        if (menu.opensDialog) {
          setAboutOpen(true);
          return;
        }
        // 菜单已经打开时（例如先用 Enter 打开），方向键要直接进条目——只把
        // openMenuId 重设成同一个值不会触发定位 effect，焦点会卡在触发按钮上。
        if (openMenuId === menu.id) {
          const items = Array.from(
            dropdownRef.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? [],
          );
          const target = event.key === "ArrowDown" ? items[0] : items[items.length - 1];
          target?.focus({ preventScroll: true });
          return;
        }
        focusMenuOnOpenRef.current = true;
        setOpenMenuId(menu.id);
        return;
      }
      case "Escape": {
        event.preventDefault();
        if (openMenuId) setOpenMenuId(null);
        else {
          setFocusIndex(-1);
          (document.activeElement as HTMLElement | null)?.blur();
        }
        return;
      }
      case "Home":
        event.preventDefault();
        focusTrigger(0);
        return;
      case "End":
        event.preventDefault();
        focusTrigger(DESKTOP_MENUS.length - 1);
        return;
      case "Tab":
        // Tab 离开菜单栏：收起下拉，焦点继续往下走（浏览器默认行为）。
        setOpenMenuId(null);
        setFocusIndex(-1);
        return;
      default:
    }
  };

  const handleDropdownKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const items = Array.from(
      dropdownRef.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? [],
    );
    const active = document.activeElement;
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
      case "ArrowRight":
      case "ArrowLeft":
        event.preventDefault();
        switchMenu(event.key === "ArrowRight" ? 1 : -1);
        return;
      case "Escape":
        event.preventDefault();
        closeAndFocusTrigger();
        return;
      case "Tab":
        setOpenMenuId(null);
        return;
      default:
    }
  };

  const dropdownNode =
    openMenu && !openMenu.opensDialog && dropdown
      ? createPortal(
          <div
            ref={dropdownRef}
            id={`${MENUBAR_ID}-${openMenu.id}`}
            className="app-titlebar-menu-dropdown"
            role="menu"
            aria-label={t(openMenu.labelKey)}
            style={{ left: dropdown.left, top: dropdown.top, zIndex: layer.popupBase }}
            onKeyDown={handleDropdownKeyDown}
          >
            {openMenu.items.map((item) => (
              <Fragment key={item.key}>
                {item.separatorBefore ? (
                  <div className="app-titlebar-menu-separator" role="separator" />
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="app-titlebar-menu-item"
                  data-menu-item-id={item.key}
                  aria-label={t(desktopMenuItemLabelKey(item, windowState.maximized))}
                  onClick={() => runItem(item)}
                >
                  <span className="app-titlebar-menu-label">
                    {t(desktopMenuItemLabelKey(item, windowState.maximized))}
                  </span>
                  {shortcutLabel(item, isMac) ? (
                    <span className="app-titlebar-menu-shortcut">{shortcutLabel(item, isMac)}</span>
                  ) : null}
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        ref={barRef}
        className={`app-titlebar${isMac ? " app-titlebar--mac" : ""}`}
        data-testid="desktop-titlebar"
        data-hidden={windowState.fullscreen ? "true" : undefined}
        aria-label={t("appHeader.desktopMenu.aria")}
      >
        {/* 拖拽区按 WCO 暴露的 titlebar-area 走，避免盖住系统绘制的三颗按钮；
            右侧没被本元素覆盖的部分由主进程覆盖层同色补齐。 */}
        <div className="app-titlebar-drag">
          <div
            id={MENUBAR_ID}
            className="app-titlebar-menus"
            role="menubar"
            aria-label={t("appHeader.desktopMenu.aria")}
          >
            {DESKTOP_MENUS.map((menu, index) => (
              <button
                key={menu.id}
                ref={(node) => {
                  triggerRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                aria-haspopup={menu.opensDialog ? "dialog" : "menu"}
                aria-expanded={menu.opensDialog ? undefined : openMenuId === menu.id}
                aria-controls={
                  openMenuId === menu.id && !menu.opensDialog
                    ? `${MENUBAR_ID}-${menu.id}`
                    : undefined
                }
                tabIndex={index === (focusIndex >= 0 ? focusIndex : 0) ? 0 : -1}
                data-menu-id={menu.id}
                className="app-titlebar-menu-trigger"
                data-open={openMenuId === menu.id ? "true" : "false"}
                onFocus={() => setFocusIndex(index)}
                onClick={() => toggleTrigger(menu, false)}
                onMouseEnter={() => {
                  // 已展开时悬停切换（Windows 习惯，§19.5-1）；「关于」弹窗不参与。
                  if (openMenuId && openMenuId !== menu.id && !menu.opensDialog) {
                    setOpenMenuId(menu.id);
                  }
                }}
                onKeyDown={(event) => handleTriggerKeyDown(event, index)}
              >
                {t(menu.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {dropdownNode}
      <AboutDesktopDialog open={aboutOpen} bridge={bridge} onClose={() => setAboutOpen(false)} />
    </>
  );
}
