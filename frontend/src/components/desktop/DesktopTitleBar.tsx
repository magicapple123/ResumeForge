// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面自绘标题栏（问题清单 §19）。
 *
 * 32px 高的标题栏住在应用根（`#root > .ant-app` 之内），左侧六个菜单，右侧三颗窗口
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
 * 本轮 #34 在这里接的四件事：重新加载（34E，路由记忆见 desktopRouteMemory）、
 * 窗口置顶勾选（34A，实态读自 useDesktopWindowState）、复制诊断信息（34D）、
 * 撤销/重做置灰（34F，焦点状态见 useDesktopEditableFocus）。
 *
 * 动作全部通过 desktopShellBridge 的固定动作 id 交给主进程；渲染层不直接碰 Electron。
 */
import { App } from "antd";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AboutDesktopDialog from "./AboutDesktopDialog";
import DesktopMenuDropdown, { MENU_ITEM_SELECTOR } from "./DesktopMenuDropdown";
import { copyDesktopDiagnostics } from "./desktopDiagnostics";
import { requestJobUrlImport } from "./desktopJobImport";
import {
  DESKTOP_MENUS,
  desktopMenuIndex,
  type DesktopMenu,
  type DesktopMenuItem,
} from "./desktopMenuModel";
import { useDesktopRouteMemory } from "./desktopRouteMemory";
import {
  getDesktopShellBridge,
  isDesktopShell,
  openUserGuideFromMenu,
  requestDesktopQuit,
  type DesktopShellBridge,
} from "./desktopShellBridge";
import TitleBarPlaceholder from "./TitleBarPlaceholder";
import { useDesktopEditableFocus } from "./useDesktopEditableFocus";
import { useDesktopMenuExport } from "./useDesktopMenuExport";
import { useDesktopMenuShortcuts } from "./useDesktopMenuShortcuts";
import { useDesktopWindowState } from "./useDesktopWindowState";
import { useResolvedTheme } from "../../features/theme/themeStore";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import "../../styles/desktop-titlebar.css";

const MENUBAR_ID = "desktop-titlebar-menubar";

interface DropdownPosition {
  left: number;
  top: number;
}

/**
 * 外层只做"是不是桌面壳"的分流：浏览器里不挂任何 hook、不渲染任何元素。
 *
 * 分流依据是 **`window.splash.isDesktop`**（主进程最早注入、所有壳版本都有它），
 * 不是自绘标题栏桥：桥是 2.1 才加的，旧壳只有 splash。按桥分流会让旧壳整条标题栏
 * 都不渲染 → 32px 没人占位 → 系统三颗按钮浮在页面内容上（P1-1 的根因之一）。
 * 桥缺失时退化成纯占位条，占位与菜单是两件事，不能互相绑死。
 */
export default function DesktopTitleBar() {
  if (!isDesktopShell()) return null;
  const bridge = getDesktopShellBridge();
  if (!bridge) return <TitleBarPlaceholder />;
  return <DesktopTitleBarInner bridge={bridge} />;
}

function DesktopTitleBarInner({ bridge }: { bridge: DesktopShellBridge }) {
  const locale = useLocale();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const resolvedTheme = useResolvedTheme();
  const isMac = bridge.platform === "darwin";
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [dropdown, setDropdown] = useState<DropdownPosition | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const focusMenuOnOpenRef = useRef(false);

  // 进入全屏时收起下拉：标题栏马上要被隐藏，留着菜单没有意义。走窗口状态的推送回调
  // 而不是在 effect 里对 fullscreen 做 setState——那属于"订阅外部系统"的场景。
  const closeMenuOnFullScreen = useCallback((fullscreen: boolean) => {
    if (fullscreen) setOpenMenuId(null);
  }, []);

  // 窗口实态（最大化 / 全屏 / 置顶 / 可编辑焦点）：菜单文案、勾选态、置灰都读它。
  const {
    windowState,
    refresh: refreshWindowState,
    merge: mergeWindowState,
  } = useDesktopWindowState(bridge, { onFullScreenChange: closeMenuOnFullScreen });

  const applyEditableFocus = useCallback(
    (editable: boolean) => mergeWindowState({ editableFocus: editable }),
    [mergeWindowState],
  );
  const { restoreEditableFocus } = useDesktopEditableFocus(bridge, applyEditableFocus);

  // #34E：路由记忆（刷新后还停在原页面）挂在桌面壳里，浏览器版不参与。
  useDesktopRouteMemory(navigate, location);

  const openMenu = openMenuId
    ? (DESKTOP_MENUS.find((menu) => menu.id === openMenuId) ?? null)
    : null;

  // 主题同步：标题栏覆盖层由主进程绘制，深浅色切换必须显式告诉它。
  useEffect(() => {
    bridge.setTheme?.(resolvedTheme);
  }, [bridge, resolvedTheme]);

  // #34A / #34F：**菜单打开前**重新读一次窗口实态。勾选态与置灰态必须来自窗口，
  // 不能沿用上一次打开菜单时的记忆（上一次动作失败或窗口被系统改过时会反过来）。
  useEffect(() => {
    if (openMenuId) refreshWindowState();
  }, [openMenuId, refreshWindowState]);

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

  const reloadPage = useCallback(() => {
    // 路由记忆由 useDesktopRouteMemory 在每次路由变化时写下，主进程 reload 的是同一个
    // URL；这条 IPC 只是"让页面重新加载"，不改变地址。
    const pending = bridge.menuAction?.("view.reload");
    if (pending) void pending.catch(() => undefined);
  }, [bridge]);

  // 加速键：文件 (Ctrl+N / Ctrl+O)、视图 (Ctrl+R / F12 / Ctrl+± / Ctrl+0 / F11)、
  // 关闭窗口（Alt+F4 / ⌘W）；编辑类交给 Chromium。
  useDesktopMenuShortcuts({ bridge, isMac, navigate, onReload: reloadPage });

  // 下拉定位：贴着触发按钮下沿并夹进视口（jsdom 量到 0 时按 0 处理，不影响断言）。
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
    focusableItems(dropdownRef)[0]?.focus({ preventScroll: true });
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
      setFocusIndex(next);
      focusMenuOnOpenRef.current = true;
      setOpenMenuId(DESKTOP_MENUS[next].id);
    },
    [openMenuId],
  );

  /** 执行一个主进程动作；复选类条目用回执里的实态纠正勾选（#34A）。 */
  const runIpc = useCallback(
    (action: string | undefined, item?: DesktopMenuItem) => {
      if (!action) return;
      // O3：编辑类命令只作用于焦点元素，而点自绘菜单项会把焦点移到标题栏——先把焦点
      // 还给最近的可编辑元素，否则「菜单点撤销/剪切」看起来可点、实际是 no-op。
      if (item?.focusEditableBeforeRun) restoreEditableFocus();
      const pending = bridge.menuAction?.(action);
      if (!pending) return;
      void pending
        .then((reply) => {
          if (item?.checkbox !== "alwaysOnTop" || !reply?.ok) return;
          const result = reply.result as { alwaysOnTop?: unknown } | undefined;
          if (result && typeof result.alwaysOnTop === "boolean") {
            mergeWindowState({ alwaysOnTop: result.alwaysOnTop });
          } else {
            // 回执里没有实态（旧壳）：退回到"重新读一次窗口"，绝不自作主张翻转。
            refreshWindowState();
          }
        })
        .catch(() => undefined);
    },
    [bridge, mergeWindowState, refreshWindowState, restoreEditableFocus],
  );

  const copyDiagnostics = useCallback(() => {
    void copyDesktopDiagnostics(bridge, { theme: resolvedTheme, locale })
      .then((outcome) => {
        if (outcome.ok) message.success(t("appHeader.desktopMenu.diagnostics.copied"));
        else message.error(t("appHeader.desktopMenu.diagnostics.copyFailed"));
      })
      .catch(() => message.error(t("appHeader.desktopMenu.diagnostics.copyFailed")));
  }, [bridge, locale, message, resolvedTheme]);

  // #34C：三档导出里的两个下载动作（下载实现在 desktopExport.ts，toast 收尾在 hook 里）。
  const exportActions = useDesktopMenuExport(message);

  const runItem = useCallback(
    (item: DesktopMenuItem) => {
      setOpenMenuId(null);
      switch (item.kind) {
        case "navigate":
          if (item.path) navigate(item.path);
          return;
        case "ipc":
          runIpc(item.ipcAction, item);
          return;
        case "quit":
          requestDesktopQuit();
          return;
        case "open-guide":
          openUserGuideFromMenu();
          return;
        case "reload":
          reloadPage();
          return;
        case "copy-diagnostics":
          copyDiagnostics();
          return;
        case "open-job-import":
          // 先跳岗位广场再请求打开：弹窗与"导入后刷新列表"的 onImported 都在那一页，
          // 标题栏不另挂一套弹窗（见 desktopJobImport.ts 的文件头）。
          navigate("/jobs");
          requestJobUrlImport();
          return;
        case "export-favorites":
          exportActions.runFavorites();
          return;
        case "export-knowledge":
          exportActions.runKnowledge();
          return;
        case "submenu":
          // 子菜单的展开/收起由下拉自己处理（runItem 只接收叶子动作）。
          return;
        case "about":
          setAboutOpen(true);
          return;
        default:
      }
    },
    [copyDiagnostics, exportActions, navigate, reloadPage, runIpc],
  );

  const toggleTrigger = (menu: DesktopMenu) => {
    if (openMenuId === menu.id) {
      setOpenMenuId(null);
      return;
    }
    focusMenuOnOpenRef.current = false;
    setOpenMenuId(menu.id);
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    const menu = DESKTOP_MENUS[index];
    switch (event.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        if (openMenuId) switchMenu(step);
        else focusTrigger(index + step);
        return;
      }
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        setFocusIndex(index);
        // 菜单已经打开时（例如先用 Enter 打开），方向键要直接进条目——只把
        // openMenuId 重设成同一个值不会触发定位 effect，焦点会卡在触发按钮上。
        if (openMenuId === menu.id) {
          const items = focusableItems(dropdownRef);
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
                aria-haspopup="menu"
                aria-expanded={openMenuId === menu.id}
                aria-controls={openMenuId === menu.id ? `${MENUBAR_ID}-${menu.id}` : undefined}
                tabIndex={index === (focusIndex >= 0 ? focusIndex : 0) ? 0 : -1}
                data-menu-id={menu.id}
                className="app-titlebar-menu-trigger"
                data-open={openMenuId === menu.id ? "true" : "false"}
                onFocus={() => setFocusIndex(index)}
                onClick={() => toggleTrigger(menu)}
                onMouseEnter={() => {
                  // 已展开时悬停切换（Windows 习惯，§19.5-1）。
                  if (openMenuId && openMenuId !== menu.id) setOpenMenuId(menu.id);
                }}
                onKeyDown={(event) => handleTriggerKeyDown(event, index)}
              >
                {t(menu.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {openMenu && dropdown ? (
        <DesktopMenuDropdown
          menu={openMenu}
          position={dropdown}
          isMac={isMac}
          maximized={windowState.maximized}
          alwaysOnTop={Boolean(windowState.alwaysOnTop)}
          editableFocus={Boolean(windowState.editableFocus)}
          dropdownRef={dropdownRef}
          onRun={runItem}
          onSwitchMenu={switchMenu}
          onEscape={closeAndFocusTrigger}
          onDismiss={() => setOpenMenuId(null)}
        />
      ) : null}
      <AboutDesktopDialog open={aboutOpen} bridge={bridge} onClose={() => setAboutOpen(false)} />
    </>
  );
}

/** 下拉里可聚焦的条目：跳过禁用项（禁用的按钮不该出现在 Tab / 方向键顺序里）。 */
function focusableItems(ref: { current: HTMLDivElement | null }): HTMLButtonElement[] {
  const all = Array.from(
    ref.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR) ?? [],
  );
  return all.filter((item) => !item.disabled);
}
