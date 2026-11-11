// SPDX-License-Identifier: Apache-2.0
"use strict";

// 自绘标题栏的 IPC 注册（问题清单 §19）：main.js 只留一行装配，动作表 / 发送方校验 /
// 主题同步都在这里。三条安全约束：
//   1. 只接受**主窗口**发来的消息（event.sender === mainWindow.webContents）：页面里的
//      第三方内容或未来多开的 webContents 不能驱动编辑/窗口动作；
//   2. 动作只认 desktop-menu.js 的固定 id，渲染层不能传任意 shell 调用；
//   3. 不 require("electron")——ipcMain 由 main.js 注入，离线用例可以直接喂假 ipcMain。

const {
  createDesktopMenuActions,
} = require("./desktop-menu");
const { readRecentProblems } = require("./diagnostic-summary");

/** 通道名：preload.js 与 frontend 的 desktopShell 桥必须逐字一致。 */
const CHANNELS = {
  menuAction: "desktop:menu-action",
  getWindowState: "desktop:get-window-state",
  setTheme: "desktop:set-theme",
  windowState: "desktop:window-state",
  // P2-2 B：设置页「检查更新」在桌面形态下走这条通道（preload.js 的 window.rfDesktop）。
  // 它和「关于 → 检查更新」到的是同一个 runManualUpdateCheck，行为完全一样。
  checkUpdate: "desktop:check-update",
  // #34F：渲染层把「焦点在不在可编辑区」报过来。这是一条**单向**通道（只写布尔），
  // 读回走 getWindowState 的快照——菜单打开前会重新读一次，两边因此同源。
  editableFocus: "desktop:editable-focus",
};

/** 窗口是否置顶（#34A）：拿不到窗口 / API 缺失一律按 false，绝不让快照抛错。 */
function readAlwaysOnTop(getWindow) {
  const win = getWindow();
  if (!win) return false;
  try {
    if (typeof win.isDestroyed === "function" && win.isDestroyed()) return false;
    return typeof win.isAlwaysOnTop === "function" ? Boolean(win.isAlwaysOnTop()) : false;
  } catch {
    return false;
  }
}

/** 只信主窗口：sender 缺失 / 窗口已销毁 / 非主窗口一律拒绝。 */
function isMainWindowSender(event, getWindow) {
  const win = getWindow();
  if (!event || !event.sender || !win) return false;
  try {
    if (win.isDestroyed()) return false;
    return event.sender === win.webContents;
  } catch {
    return false;
  }
}

/**
 * @param {object} deps
 * @param {object} deps.ipcMain Electron ipcMain
 * @param {object} deps.app Electron app
 * @param {function(): (object|null)} deps.getWindow 当前主窗口
 * @param {object} deps.shell Electron shell
 * @param {function(): string} deps.getDataDir 用户数据目录
 * @param {function(): (string|null)} deps.getLogDir 诊断日志目录
 * @param {function(): void} deps.runUpdateCheck 手动检查更新
 * @param {object} deps.titleBar lib/titlebar 的控制器
 * @param {function(string): void} [deps.logLine]
 */
function registerDesktopShellIpc(deps) {
  const {
    ipcMain,
    app,
    getWindow,
    shell,
    getDataDir,
    getLogDir,
    runUpdateCheck,
    titleBar,
    logLine = () => {},
  } = deps;

  // #34F 的实态：渲染层每次焦点进出可编辑区都会报一次；getWindowState 把它一起交回去。
  let editableFocus = false;

  const menu = createDesktopMenuActions({
    app,
    getWindow,
    shell,
    getDataDir,
    getLogDir,
    runUpdateCheck,
    // #34D：日志目录由 shell-paths 裁决（getLogDir 可能返回 null），这里只负责读尾部。
    readRecentProblems: () => readRecentProblems({ logDir: getLogDir() }),
    logLine,
  });

  const trusted = (event) => isMainWindowSender(event, getWindow);

  ipcMain.handle(CHANNELS.menuAction, (event, payload) => {
    if (!trusted(event)) return { ok: false, error: "untrusted sender" };
    const action = payload && typeof payload.action === "string" ? payload.action : "";
    return menu.run(action);
  });

  // #34A / #34F：菜单打开前渲染层会重新读一次这份快照，所以置顶与可编辑焦点必须是
  // **此刻的实态**，不能是渲染层自己的记忆：置顶读窗口，焦点读渲染层上报的最后一个值。
  ipcMain.handle(CHANNELS.getWindowState, (event) =>
    trusted(event)
      ? {
          ...titleBar.windowState(),
          alwaysOnTop: readAlwaysOnTop(getWindow),
          editableFocus,
        }
      : { maximized: false, fullscreen: false, alwaysOnTop: false, editableFocus: false },
  );

  ipcMain.on(CHANNELS.editableFocus, (event, value) => {
    if (trusted(event)) editableFocus = Boolean(value);
  });

  // P2-2 B：设置页那个「检查更新」按钮。复用同一套发送方校验（只有主窗口能触发），
  // 也不接受任何参数——渲染层无法借它指定 URL / 版本 / 安装包，能做的只有"检查一次"。
  // 结果由 runManualUpdateCheck 用系统弹窗给出：有新版弹「立即更新/暂不」，已是最新弹
  // 「已是最新版本」。这里永远返回 { ok: true }，异常由 updater 自己记日志并弹错误框。
  ipcMain.handle(CHANNELS.checkUpdate, (event) => {
    if (!trusted(event)) return { ok: false, error: "untrusted sender" };
    if (typeof runUpdateCheck !== "function") return { ok: false, error: "update check unavailable" };
    try {
      // runManualUpdateCheck 是同步发起、内部 .catch 收尾的（不返回 Promise），
      // 所以这里不能 await；万一它同步抛出，也要把 ok:false 交回渲染层而不是崩主进程。
      runUpdateCheck();
    } catch (err) {
      logLine(`manual update check from settings failed: ${err}`);
      return { ok: false, error: "update check failed" };
    }
    return { ok: true };
  });

  ipcMain.on(CHANNELS.setTheme, (event, theme) => {
    if (trusted(event)) titleBar.applyTheme(theme);
  });

  return { menu, channels: CHANNELS };
}

module.exports = { CHANNELS, isMainWindowSender, registerDesktopShellIpc };
