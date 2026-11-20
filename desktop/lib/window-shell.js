// SPDX-License-Identifier: Apache-2.0
"use strict";

// 窗口壳装配（Q11）：把"关闭行为 + 托盘"这两件互相引用的事收到一处。
//
// 为什么单独一个文件：`desktop/main.js` 正好 500 行（`desktop/**/*.js` 同样受 500 行预算管），
// 而这一批要给托盘加四项、把关闭卡片换成自绘窗口——往 main.js 里加任何一行都会越界。
// 抽出来之后 main.js 只留一次调用，两块之间的相互引用（记忆变化 → 刷新托盘勾选态）
// 也不再需要 main.js 里的 `let trayManager`。
//
// 依赖全部注入：本模块不 require("electron")，离线用例可以直接构造。

const { createCloseBehavior } = require("./close-behavior");
const { createTrayManager } = require("./tray-menu");

/**
 * @param {object} deps
 * @param {object} deps.app
 * @param {object} deps.Tray
 * @param {object} deps.Menu
 * @param {string} deps.iconPath
 * @param {string} [deps.darkIconPath] 暗色托盘图标（托盘跟随主题，WF-20）
 * @param {function(): boolean} [deps.getIsDark] 创建托盘时的主题判定
 * @param {function} deps.promptClose 自绘关闭卡片（lib/close-dialog.js 的返回值）
 * @param {function(): (object|null)} deps.getWindow
 * @param {function(): boolean} deps.isQuitting
 * @param {function(boolean): void} deps.setQuitting
 * @param {object} deps.store 关闭记忆读写句柄
 * @param {function(): (object|null)} [deps.getMenu] 返回 `registerDesktopShellIpc` 的 dispatcher
 *   （有 `run(id)`）。用函数而不是对象：IPC 在 main.js 更靠后才注册，构造窗口壳时它还不存在。
 * @param {function(): ("zh" | "en")} [deps.getLocale] 壳层当前语言（托盘文案用）
 * @param {function(string): void} [deps.logLine]
 */
function createWindowShell(deps) {
  const { app, Tray, Menu, iconPath, promptClose, getWindow, isQuitting, setQuitting } = deps;
  const { store, getMenu, getLocale, logLine = () => {} } = deps;
  const { darkIconPath, getIsDark } = deps;

  /**
   * 托盘要能触发菜单动作（打开数据目录 / 日志目录 / 复制诊断 / 检查更新）。
   *
   * 「复制诊断信息」在渲染层是"主进程给数据、渲染层拼文本并写剪贴板"；从托盘进来时
   * **没有渲染层消费方**，原样返回等于什么都没发生（2026-11-20 用户："点了没反应"）。
   * 所以托盘这条路自己把主进程那半份写成纯文本塞进剪贴板，至少能拿去贴给人看。
   */
  const runMenuAction = (id) => {
    const menu = typeof getMenu === "function" ? getMenu() : null;
    if (!menu || typeof menu.run !== "function") return;
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
    // 记忆变化后刷新托盘「关闭窗口时询问」的勾选态。
    onPreferenceChanged: () => {
      if (trayManager) trayManager.refresh();
    },
  });
  trayManager = createTrayManager({
    Tray,
    Menu,
    iconPath,
    darkIconPath,
    getIsDark,
    app,
    getWindow,
    getRemembered: () => closeBehavior.getRemembered(),
    clearRemembered: () => closeBehavior.clearRemembered(),
    runMenuAction,
    getLocale,
    logLine,
  });

  return { closeBehavior, trayManager };
}

module.exports = { createWindowShell };
