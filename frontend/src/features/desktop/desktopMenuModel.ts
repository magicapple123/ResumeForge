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
 *  - quit / open-guide：走既有桥（退出仍是 before-quit 唯一停止点）；
 *  - reload / copy-diagnostics / about：桌面壳本轮补的三类全局动作（#34E/D/I）。
 * 渲染层永远不直接碰 Electron API，也不接收/拼接任意 URL。
 */
import { formatShortcut } from "../shortcuts/matchShortcut";
import type { MessageKey } from "../../i18n";

export type DesktopMenuId = "file" | "edit" | "view" | "window" | "help" | "about";

export type DesktopMenuAction =
  | "navigate"
  | "ipc"
  | "quit"
  | "open-guide"
  /** 重新加载当前页面（#34E）：刷新前先记住路由，见 desktopRouteMemory.ts。 */
  | "reload"
  /** 复制诊断信息（#34D）：主进程给日志、渲染层补设置，合成后写剪贴板。 */
  | "copy-diagnostics"
  /** 从链接导入岗位（#34B）：跳岗位广场并调活页面上同一个 ImportFromUrlLauncher。 */
  | "open-job-import"
  /** 父级子菜单（#34C）：本身不执行动作，展开 children。 */
  | "submenu"
  /** 导出收藏夹 CSV（#34C，渲染层 fetch + blob 下载）。 */
  | "export-favorites"
  /** 导出知识库 Markdown 目录 zip（#34C，复用 api/knowledge.ts 的封装）。 */
  | "export-knowledge"
  /** 打开「关于」弹窗（#34I：与其它菜单一致，先展开下拉再点一项）。 */
  | "about";

export interface DesktopMenuItem {
  /** 稳定 id（React key / 测试定位用），不是文案。 */
  key: string;
  labelKey: MessageKey;
  /** 窗口已最大化时替换 labelKey（「最大化」→「还原」）。 */
  labelKeyWhenMaximized?: MessageKey;
  /** 规范组合键（交给 formatShortcut 按平台排版）。 */
  shortcut?: string;
  /** macOS 上的另一套组合键（Alt+F4 vs ⌘W 这类平台惯例）。 */
  shortcutMac?: string;
  /** 无法用 formatShortcut 表达时直接给的展示文本（F11 / F12）。 */
  shortcutText?: string;
  kind: DesktopMenuAction;
  /** kind === "navigate" 时的目标路径（可带 query）。 */
  path?: string;
  /** kind === "ipc" 时的主进程动作 id。 */
  ipcAction?: string;
  /** 在它前面画一条分隔线（Windows 菜单习惯）。 */
  separatorBefore?: boolean;
  /** 子菜单条目（kind === "submenu"）：结构递归，渲染与键盘导航共用同一套类型。 */
  children?: DesktopMenuItem[];
  /**
   * 复选类菜单项（#34A）：勾选态只来自窗口实态，模型不自己记一份。
   * 值是「从窗口状态的哪个字段读」。
   */
  checkbox?: "alwaysOnTop";
  /** 只有焦点在可编辑区时才可用（#34F：撤销 / 重做的置灰依据）。 */
  requiresEditableFocus?: boolean;
  /**
   * 执行前把焦点还给最近的可编辑元素（#34 O3）。编辑命令（webContents.undo 等）只作用于
   * 焦点元素，而点自绘菜单项会把焦点移到标题栏——不还焦点，菜单项就是"可点但无效"。
   */
  focusEditableBeforeRun?: boolean;
}

export interface DesktopMenu {
  id: DesktopMenuId;
  labelKey: MessageKey;
  items: DesktopMenuItem[];
}

/** 菜单项在当前窗口状态下的勾选态（只有复选类菜单项有）。 */
export function desktopMenuItemChecked(
  item: DesktopMenuItem,
  state: { alwaysOnTop?: boolean },
): boolean {
  return item.checkbox === "alwaysOnTop" ? Boolean(state.alwaysOnTop) : false;
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
        // #34B：#16C 的「从链接导入」是**全局采集入口**，与"当前在哪一页"无关，正是
        // 菜单该放的。文案直接复用岗位上那个按钮的 key（同一个动作不造第二套说法）。
        key: "file.importJobFromUrl",
        labelKey: "jobsImport.launcher",
        kind: "open-job-import",
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
        // #34C：「备份与恢复…」是整库快照，粒度太粗。文件菜单的"进"有 4 个
        // （新建/从链接导入/导入数据集/打开数据目录），"出"只有整库一种——这里补成
        // 三级导出。三项都复用既有能力，不另写请求层：
        //  - 收藏夹 CSV：api/jobs.ts 的 downloadFavoritesExport（#28F，CSV 带 UTF-8 BOM）；
        //  - 知识库 Markdown 目录：api/knowledge.ts 的 exportKnowledgeMarkdown（#29）；
        //  - 整库备份：仍是设置页的备份与恢复（id 保持 file.backupRestore 不变）。
        key: "file.export",
        labelKey: "appHeader.desktopMenu.item.export",
        kind: "submenu",
        children: [
          {
            key: "file.exportFavorites",
            labelKey: "appHeader.desktopMenu.item.exportFavorites",
            kind: "export-favorites",
          },
          {
            key: "file.exportKnowledge",
            labelKey: "appHeader.desktopMenu.item.exportKnowledge",
            kind: "export-knowledge",
          },
          {
            key: "file.backupRestore",
            labelKey: "appHeader.desktopMenu.item.backupAll",
            kind: "navigate",
            path: "/settings?tab=backup",
          },
        ],
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
        // #34F：焦点不在可编辑区时 webContents.undo() 是 no-op，菜单却可点——
        // 置灰的依据由 useDesktopEditableFocus 经 IPC 报给主进程再读回来。
        key: "edit.undo",
        labelKey: "appHeader.desktopMenu.item.undo",
        shortcut: "mod+z",
        kind: "ipc",
        ipcAction: "edit.undo",
        requiresEditableFocus: true,
        focusEditableBeforeRun: true,
      },
      {
        key: "edit.redo",
        labelKey: "appHeader.desktopMenu.item.redo",
        shortcut: "mod+y",
        kind: "ipc",
        ipcAction: "edit.redo",
        requiresEditableFocus: true,
        focusEditableBeforeRun: true,
      },
      {
        key: "edit.cut",
        labelKey: "appHeader.desktopMenu.item.cut",
        shortcut: "mod+x",
        separatorBefore: true,
        kind: "ipc",
        ipcAction: "edit.cut",
        // 编辑命令作用在焦点元素上：执行前先还焦点（见 focusEditableBeforeRun 注释）。
        focusEditableBeforeRun: true,
      },
      {
        key: "edit.copy",
        labelKey: "appHeader.desktopMenu.item.copy",
        shortcut: "mod+c",
        kind: "ipc",
        ipcAction: "edit.copy",
        // 编辑命令作用在焦点元素上：执行前先还焦点（见 focusEditableBeforeRun 注释）。
        focusEditableBeforeRun: true,
      },
      {
        key: "edit.paste",
        labelKey: "appHeader.desktopMenu.item.paste",
        shortcut: "mod+v",
        kind: "ipc",
        ipcAction: "edit.paste",
        // 编辑命令作用在焦点元素上：执行前先还焦点（见 focusEditableBeforeRun 注释）。
        focusEditableBeforeRun: true,
      },
      {
        key: "edit.selectAll",
        labelKey: "appHeader.desktopMenu.item.selectAll",
        shortcut: "mod+a",
        kind: "ipc",
        ipcAction: "edit.selectAll",
        // 编辑命令作用在焦点元素上：执行前先还焦点（见 focusEditableBeforeRun 注释）。
        focusEditableBeforeRun: true,
      },
    ],
  },
  {
    id: "view",
    labelKey: "appHeader.desktopMenu.view",
    items: [
      {
        // #34E：自绘菜单替换掉 Electron 默认菜单后 reload / toggleDevTools 的加速键
        // 随之消失，这里把它们补回来（刷新不丢路由见 desktopRouteMemory.ts）。
        key: "view.reload",
        labelKey: "appHeader.desktopMenu.item.reload",
        shortcut: "mod+r",
        kind: "reload",
      },
      {
        key: "view.toggleDevTools",
        labelKey: "appHeader.desktopMenu.item.toggleDevTools",
        shortcutText: "F12",
        kind: "ipc",
        ipcAction: "view.toggleDevTools",
      },
      {
        key: "view.zoomIn",
        labelKey: "appHeader.desktopMenu.item.zoomIn",
        shortcut: "mod+=",
        separatorBefore: true,
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
        // #34A：实时语音面试要"边听面试官边说话"，窗口被别的应用盖住功能就作废。
        // 勾选态不在这里存：菜单打开前从窗口读实态（useDesktopWindowState.refresh）。
        key: "window.toggleAlwaysOnTop",
        labelKey: "appHeader.desktopMenu.item.alwaysOnTop",
        separatorBefore: true,
        kind: "ipc",
        ipcAction: "window.toggleAlwaysOnTop",
        checkbox: "alwaysOnTop",
      },
      {
        // 「关闭窗口」必须走 window.close() -> 第 18 条的 close handler（弹二选一/读记忆），
        // 不能直接 destroy()（§19.3 / §19.8 反证要求）。
        // #34G：Windows 用户的第一反应是 Alt+F4；macOS 惯例是 ⌘W（两套都在
        // useDesktopMenuShortcuts 里真的拦下来，不能只写展示文本）。
        key: "window.close",
        labelKey: "appHeader.desktopMenu.item.closeWindow",
        shortcut: "alt+f4",
        shortcutMac: "mod+w",
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
        // #34D：只有「打开日志目录」等于让用户自己在几 MB 里 grep。一键复制一份
        // 可直接贴给支持者的摘要（版本/平台/目录/最近 WARN、ERROR/模型配置/开关）。
        key: "help.copyDiagnostics",
        labelKey: "appHeader.desktopMenu.item.copyDiagnostics",
        kind: "copy-diagnostics",
      },
      // #34H：「检查更新」只留在「关于」里（关于弹窗里已有版本信息，两处都放会分裂）。
    ],
  },
  {
    // #34I：六个一级菜单里只有它原来"点开直接弹窗、没有下拉"。改成与其它菜单一致：
    // 先展开下拉，下拉里放一项「关于简历通」。
    id: "about",
    labelKey: "appHeader.desktopMenu.about",
    items: [
      {
        key: "about.open",
        labelKey: "appHeader.desktopMenu.about.title",
        kind: "about",
      },
    ],
  },
];

/** 菜单项在当前窗口状态下的展示文案（「最大化/还原」是唯一会变的）。 */
export function desktopMenuItemLabelKey(item: DesktopMenuItem, maximized: boolean): MessageKey {
  return maximized && item.labelKeyWhenMaximized ? item.labelKeyWhenMaximized : item.labelKey;
}

/** 加速键提示文本：快捷文本原样，其余交给 formatShortcut 按平台排版（macOS 有单独键位）。 */
export function desktopMenuItemShortcut(item: DesktopMenuItem, isMac: boolean): string {
  if (item.shortcutText) return item.shortcutText;
  const binding = isMac ? (item.shortcutMac ?? item.shortcut) : item.shortcut;
  return binding ? formatShortcut(binding, { mac: isMac }) : "";
}

/** 某个菜单在 DESKTOP_MENUS 里的下标；不存在返回 -1（键盘左右切换用）。 */
export function desktopMenuIndex(id: string): number {
  return DESKTOP_MENUS.findIndex((menu) => menu.id === id);
}
