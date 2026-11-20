// SPDX-License-Identifier: Apache-2.0
"use strict";

// 窗口壳装配（Q11）：把"关闭行为 + 托盘（含自绘右键菜单）"这两件互相引用的事收到一处。
//
// 为什么单独一个文件：`desktop/main.js` 正好贴着 500 行预算（`desktop/**/*.js` 同样受
// 500 行预算管），往 main.js 里加任何一行都会越界。抽出来之后 main.js 只留一次调用，
// 两块之间的相互引用（偏好变化 → 刷新托盘、菜单选中 → 执行动作）也不再需要
// main.js 里的 `let trayManager`。
//
// 依赖全部注入：本模块不 require("electron")，离线用例可以直接构造。

const { createCloseBehavior } = require("./close-behavior");
const { createTrayManager, resolveTrayIconPath } = require("./tray-menu");
const { createTrayMenuWindow } = require("./tray-menu-window");

/**
 * @param {object} deps
 * @param {object} deps.app
 * @param {object} deps.Tray
 * @param {object} deps.BrowserWindow 自绘托盘菜单的窗口构造器
 * @param {object} deps.ipcMain 自绘托盘菜单的回执通道
 * @param {object} deps.screen 屏幕信息（workArea 按托盘图标所在那块屏算）
 * @param {string} deps.dirname main.js 所在目录（打包态 = app.asar 根）
 * @param {object} [deps.clipboard] 托盘「复制诊断」写剪贴板用
 * @param {function} deps.promptClose 自绘关闭卡片（lib/close-dialog.js 的返回值）
 * @param {function(): (object|null)} deps.getWindow
 * @param {function(): boolean} deps.isQuitting
 * @param {function(boolean): void} deps.setQuitting
 * @param {object} deps.store 关闭偏好读写句柄（lib/close-behavior.js）
 * @param {function(): (object|null)} [deps.getMenu] 返回 `registerDesktopShellIpc` 的返回壳
 *   （里面有 `menu.run(id)`）。用函数而不是对象：IPC 在 main.js 更靠后才注册，
 *   构造窗口壳时它还不存在。
 * @param {function(): ("zh" | "en")} [deps.getLocale] 壳层当前语言（托盘文案用）
 * @param {function(string): void} [deps.logLine]
 */
function createWindowShell(deps) {
  const { app, Tray, BrowserWindow, ipcMain, screen, dirname } = deps;
  const { promptClose, getWindow, isQuitting, setQuitting } = deps;
  const { store, getMenu, getLocale, logLine = () => {} } = deps;

  /**
   * 托盘要能触发菜单动作（打开数据目录 / 日志目录 / 复制诊断 / 检查更新）。
   *
   * 「复制诊断信息」在渲染层是"主进程给数据、渲染层拼文本并写剪贴板"；从托盘进来时
   * **没有渲染层消费方**，原样返回等于什么都没发生（2026-11-20 用户："点了没反应"）。
   * 所以托盘这条路自己把主进程那半份写成纯文本塞进剪贴板，至少能拿去贴给人看。
   *
   * ⚠️ 2026-11-20 的真事故：`getMenu()` 拿到的是 `{ menu, channels }` 这个返回壳，
   * 直接 `.run` 永远是 undefined，四个动作在这一行被**静默**吞掉。所以这里必须取
   * `.menu`，且不可用时要留下一条日志（失灵要可观测，不能无声）。
   */
  const runMenuAction = (id) => {
    const shell = typeof getMenu === "function" ? getMenu() : null;
    const menu = shell && shell.menu ? shell.menu : shell;
    if (!menu || typeof menu.run !== "function") {
      logLine(`tray: dispatcher unavailable: ${id}`);
      return;
    }
    let reply;
    try {
      reply = menu.run(id);
    } catch (error) {
      logLine(`tray: run ${id} failed: ${error}`);
      return;
    }
    if (id !== "help.getDiagnostics") {
      Promise.resolve(reply).catch((error) => logLine(`tray: run ${id} failed: ${error}`));
      return;
    }
    Promise.resolve(reply)
      .then((result) => {
        if (!result || result.ok !== true) {
          logLine(`tray: diagnostics failed: ${result && result.error}`);
          return;
        }
        const info = result.result || {};
        const lines = [
          `ResumeForge ${info.version || ""}  ${info.platform || ""}`.trim(),
          `data: ${info.dataDir || "-"}`,
          `logs: ${info.logDir || "-"}`,
        ];
        if (Array.isArray(info.problems) && info.problems.length > 0) {
          lines.push("", "recent problems:", ...info.problems);
        }
        if (deps && deps.clipboard && typeof deps.clipboard.writeText === "function") {
          deps.clipboard.writeText(lines.join("\r\n"));
          logLine("tray: diagnostics copied to clipboard");
        }
      })
      .catch((error) => logLine(`tray: diagnostics failed: ${error}`));
  };

  let trayManager = null;
  const closeBehavior = createCloseBehavior({
    app,
    promptClose,
    getWindow,
    isQuitting,
    setQuitting,
    store,
    logLine,
    // 偏好变化后刷新托盘（tooltip；勾选态在打开菜单时现算，不需要重建）。
    onPreferenceChanged: () => {
      if (trayManager) trayManager.refresh();
    },
  });

  // 自绘右键菜单（2026-11-20）：无边框透明窗口，模型由托盘管理器在打开那一刻生成。
  const trayMenuWindow = createTrayMenuWindow({
    BrowserWindow,
    ipcMain,
    screen,
    dirname,
    logLine,
    onChoose: (id) => {
      if (trayManager) trayManager.choose(id);
    },
  });

  trayManager = createTrayManager({
    Tray,
    iconPath: resolveTrayIconPath({ app, dirname }),
    app,
    getWindow,
    getAsk: () => closeBehavior.getAsk(),
    setAsk: (value) => closeBehavior.setAsk(value),
    runMenuAction,
    openMenu: (input) => trayMenuWindow.show(input),
    getLocale,
    logLine,
  });

  return { closeBehavior, trayManager, trayMenuWindow };
}

module.exports = { createWindowShell };
