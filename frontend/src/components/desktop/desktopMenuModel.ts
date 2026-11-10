// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面标题栏菜单的数据模型（问题清单 §19.3）。
 *
 * 纯数据 + 纯函数：菜单顺序、每项的动作类型、快捷键绑定都写在这里，组件只负责渲染与
 * 键盘交互。这样"六个菜单、顺序、动作 id"可以在单测里逐条钉死，不用渲染整棵标题栏。
 *
 * 动作类型刻意保持窄：
 *  - navigate：react-router 跳转（文件 / 帮助里依赖业务路由的项）；
 *  - ipc：交给主进程 desktop/lib/desktop-menu.js 的动作白名单；
 *  - quit / open-guide：走既有桥（退出仍是 before-quit 唯一停止点）。
 * 渲染层永远不直接碰 Electron API，也不接收/拼接任意 URL。
 */
import type { MessageKey } from "../../i18n";

export type DesktopMenuId = "file" | "edit" | "view" | "window" | "help" | "about";

export type DesktopMenuAction = "navigate" | "ipc" | "quit" | "open-guide";

export interface DesktopMenuItem {
  /** 稳定 id（React key / 测试定位用），不是文案。 */
  key: string;
  labelKey: MessageKey;
  /** 窗口已最大化时替换 labelKey（「最大化」→「还原」）。 */
  labelKeyWhenMaximized?: MessageKey;
  /** 规范组合键（交给 formatShortcut 按平台排版）。 */
  shortcut?: string;
  /** 无法用 formatShortcut 表达时直接给的展示文本（目前只有 F11）。 */
  shortcutText?: string;
  kind: DesktopMenuAction;
  /** kind === "navigate" 时的目标路径（可带 query）。 */
  path?: string;
  /** kind === "ipc" 时的主进程动作 id。 */
  ipcAction?: string;
  /** 在它前面画一条分隔线（Windows 菜单习惯）。 */
  separatorBefore?: boolean;
}

export interface DesktopMenu {
  id: DesktopMenuId;
  labelKey: MessageKey;
  /** 点击直接弹「关于」而不是展开下拉（§19.3：关于 = 纯静态弹窗）。 */
  opensDialog?: "about";
  items: DesktopMenuItem[];
}

/**
 * 六个菜单与各自条目（顺序即渲染顺序）。
 *
 * 快捷键字母**不显示**（§19.2：没有「文件(F)」这种括号字母，也不做 Alt+F 跳转）；
 * 下拉里右侧的 Ctrl+… 是真实生效的加速键提示，Alt 只负责把焦点交给菜单栏。
 */
export const DESKTOP_MENUS: DesktopMenu[] = [
  {
    id: "file",
    labelKey: "appHeader.desktopMenu.file",
    items: [
      {
        key: "file.newResume",
        labelKey: "appHeader.desktopMenu.item.newResume",
        shortcut: "mod+n",
        kind: "navigate",
        path: "/resumes",
      },
      {
        key: "file.importDataset",
        labelKey: "appHeader.desktopMenu.item.importDataset",
        shortcut: "mod+o",
        kind: "navigate",
        path: "/settings?tab=data",
      },
      {
        key: "file.openDataDir",
        labelKey: "appHeader.desktopMenu.item.openDataDir",
        kind: "ipc",
        ipcAction: "file.openDataDir",
      },
      {
        key: "file.backupRestore",
        labelKey: "appHeader.desktopMenu.item.backupRestore",
        kind: "navigate",
        path: "/settings?tab=backup",
      },
      {
        key: "file.quit",
        labelKey: "appHeader.desktopMenu.item.quit",
        separatorBefore: true,
        kind: "quit",
      },
    ],
  },
  {
    id: "edit",
    labelKey: "appHeader.desktopMenu.edit",
    items: [
      {
        key: "edit.undo",
        labelKey: "appHeader.desktopMenu.item.undo",
        shortcut: "mod+z",
        kind: "ipc",
        ipcAction: "edit.undo",
      },
      {
        key: "edit.redo",
        labelKey: "appHeader.desktopMenu.item.redo",
        shortcut: "mod+y",
        kind: "ipc",
        ipcAction: "edit.redo",
      },
      {
        key: "edit.cut",
        labelKey: "appHeader.desktopMenu.item.cut",
        shortcut: "mod+x",
        separatorBefore: true,
        kind: "ipc",
        ipcAction: "edit.cut",
      },
      {
        key: "edit.copy",
        labelKey: "appHeader.desktopMenu.item.copy",
        shortcut: "mod+c",
        kind: "ipc",
        ipcAction: "edit.copy",
      },
      {
        key: "edit.paste",
        labelKey: "appHeader.desktopMenu.item.paste",
        shortcut: "mod+v",
        kind: "ipc",
        ipcAction: "edit.paste",
      },
      {
        key: "edit.selectAll",
        labelKey: "appHeader.desktopMenu.item.selectAll",
        shortcut: "mod+a",
        kind: "ipc",
        ipcAction: "edit.selectAll",
      },
    ],
  },
  {
    id: "view",
    labelKey: "appHeader.desktopMenu.view",
    items: [
      {
        key: "view.zoomIn",
        labelKey: "appHeader.desktopMenu.item.zoomIn",
        shortcut: "mod+=",
        kind: "ipc",
        ipcAction: "view.zoomIn",
      },
      {
        key: "view.zoomOut",
        labelKey: "appHeader.desktopMenu.item.zoomOut",
        shortcut: "mod+-",
        kind: "ipc",
        ipcAction: "view.zoomOut",
      },
      {
        key: "view.zoomReset",
        labelKey: "appHeader.desktopMenu.item.zoomReset",
        shortcut: "mod+0",
        kind: "ipc",
        ipcAction: "view.zoomReset",
      },
      {
        key: "view.toggleFullscreen",
        labelKey: "appHeader.desktopMenu.item.fullscreen",
        shortcutText: "F11",
        separatorBefore: true,
        kind: "ipc",
        ipcAction: "view.toggleFullscreen",
      },
    ],
  },
  {
    id: "window",
    labelKey: "appHeader.desktopMenu.window",
    items: [
      {
        key: "window.minimize",
        labelKey: "appHeader.desktopMenu.item.minimize",
        kind: "ipc",
        ipcAction: "window.minimize",
      },
      {
        key: "window.toggleMaximize",
        labelKey: "appHeader.desktopMenu.item.maximize",
        labelKeyWhenMaximized: "appHeader.desktopMenu.item.restore",
        kind: "ipc",
        ipcAction: "window.toggleMaximize",
      },
      {
        // 「关闭窗口」必须走 window.close() -> 第 18 条的 close handler（弹二选一/读记忆），
        // 不能直接 destroy()（§19.3 / §19.8 反证要求）。
        key: "window.close",
        labelKey: "appHeader.desktopMenu.item.closeWindow",
        separatorBefore: true,
        kind: "ipc",
        ipcAction: "window.close",
      },
    ],
  },
  {
    id: "help",
    labelKey: "appHeader.desktopMenu.help",
    items: [
      { key: "help.guide", labelKey: "appHeader.desktopMenu.item.guide", kind: "open-guide" },
      {
        key: "help.keyboardShortcuts",
        labelKey: "appHeader.desktopMenu.item.keyboardShortcuts",
        kind: "navigate",
        path: "/settings?tab=appearance",
      },
      {
        key: "help.openLogDir",
        labelKey: "appHeader.desktopMenu.item.openLogDir",
        kind: "ipc",
        ipcAction: "help.openLogDir",
      },
      {
        key: "help.checkUpdate",
        labelKey: "appHeader.desktopMenu.item.checkUpdate",
        kind: "ipc",
        ipcAction: "help.checkUpdate",
      },
    ],
  },
  {
    id: "about",
    labelKey: "appHeader.desktopMenu.about",
    opensDialog: "about",
    items: [],
  },
];

/** 菜单项在当前窗口状态下的展示文案（「最大化/还原」是唯一会变的）。 */
export function desktopMenuItemLabelKey(item: DesktopMenuItem, maximized: boolean): MessageKey {
  return maximized && item.labelKeyWhenMaximized ? item.labelKeyWhenMaximized : item.labelKey;
}

/** 某个菜单在 DESKTOP_MENUS 里的下标；不存在返回 -1（键盘左右切换用）。 */
export function desktopMenuIndex(id: string): number {
  return DESKTOP_MENUS.findIndex((menu) => menu.id === id);
}
