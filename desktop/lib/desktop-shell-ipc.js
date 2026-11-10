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

/** 通道名：preload.js 与 frontend 的 desktopShell 桥必须逐字一致。 */
const CHANNELS = {
  menuAction: "desktop:menu-action",
  getWindowState: "desktop:get-window-state",
  setTheme: "desktop:set-theme",
  windowState: "desktop:window-state",
};

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

  const menu = createDesktopMenuActions({
    app,
    getWindow,
    shell,
    getDataDir,
    getLogDir,
    runUpdateCheck,
    logLine,
  });

  const trusted = (event) => isMainWindowSender(event, getWindow);

  ipcMain.handle(CHANNELS.menuAction, (event, payload) => {
    if (!trusted(event)) return { ok: false, error: "untrusted sender" };
    const action = payload && typeof payload.action === "string" ? payload.action : "";
    return menu.run(action);
  });

  ipcMain.handle(CHANNELS.getWindowState, (event) =>
    trusted(event) ? titleBar.windowState() : { maximized: false, fullscreen: false },
  );

  ipcMain.on(CHANNELS.setTheme, (event, theme) => {
    if (trusted(event)) titleBar.applyTheme(theme);
  });

  return { menu, channels: CHANNELS };
}

module.exports = { CHANNELS, isMainWindowSender, registerDesktopShellIpc };
