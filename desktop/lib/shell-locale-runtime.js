// SPDX-License-Identifier: Apache-2.0
"use strict";

// 壳层语言状态 + 语言切换后的重建（主进程侧）：托盘菜单与 tooltip、窗口标题兜底。
//
// 为什么单独一个模块：main.js 受 500 行预算约束（desktop 扩面），而这一批要让
// 托盘 / 对话框 / 标题跟随应用内语言。这里把"状态 + 重建"收成不 require electron
// 的纯逻辑，main.js 只留一行装配；离线用例可以直接注入假 Tray / 假窗口断言。
//
// 语言来源：渲染进程 React 挂载后经 desktop:set-locale 推送（唯一真相是应用内语言，
// 不是系统语言）。IPC 到达之前用系统语言兜底：app.getLocale() → LC_ALL → LANG → "en"
//（Linux 上 app.getLocale() 可能返回空串，见 lib/shell-locale.js）。

const { resolveShellLocaleFromEnvironment, t } = require("./shell-locale");

/** app.getLocale() 在旧 Electron / 未 ready 时可能不存在或抛错：一律当空串处理。 */
function readAppLocale(app) {
  try {
    return app && typeof app.getLocale === "function" ? app.getLocale() : "";
  } catch {
    return "";
  }
}

/**
 * @param {object} deps
 * @param {function(): (object|null)} deps.getWindow 当前主窗口（标题兜底用）
 * @param {function(): (object|null)} deps.getTrayManager 托盘管理器（重建菜单与 tooltip）
 * @param {function(string): void} [deps.logLine] 诊断日志
 */
function createShellLocaleRuntime(deps) {
  const { getWindow, getTrayManager, logLine = () => {} } = deps;
  let locale = "en";

  function getLocale() {
    return locale;
  }

  /**
   * IPC 到达前的兜底：按系统语言裁决一次（app.getLocale 在 Windows 上要等 ready 之后）。
   *
   * @param {object} app Electron app（getLocale）
   * @param {Record<string, string | undefined>} [environment] process.env 的可注入替身
   * @returns {"zh" | "en"}
   */
  function initializeFromApp(app, environment) {
    locale = resolveShellLocaleFromEnvironment(readAppLocale(app), environment || process.env);
    return locale;
  }

  /**
   * 应用内语言变化：更新状态并重建主进程侧的用户可见文案。
   *
   * 相同语言直接返回 false：React 首帧与服务端语言校正可能各推一次，重复重建只会闪。
   *
   * @param {unknown} next 渲染进程推来的值（只接受 "zh" / "en"）
   * @returns {boolean} true = 真的切换并重建了
   */
  function apply(next) {
    if (next !== "zh" && next !== "en") return false;
    if (next === locale) return false;
    locale = next;
    const trayManager = typeof getTrayManager === "function" ? getTrayManager() : null;
    if (trayManager && typeof trayManager.refresh === "function") {
      // refresh 内部同时重建菜单并同步 tooltip，两处文案因此永远同源。
      trayManager.refresh();
    }
    const win = typeof getWindow === "function" ? getWindow() : null;
    try {
      // 运行时标题由渲染层 RouteAccessibility 接管（已是本地化文案）；这里只覆盖
      // "切换后、下一次路由/标题更新前"的瞬间，属于兜底而不是第二套实现。
      if (win && !(typeof win.isDestroyed === "function" && win.isDestroyed())) {
        win.setTitle(t(locale, "app.name"));
      }
    } catch (err) {
      logLine(`shell locale: window title update failed: ${err}`);
    }
    logLine(`shell locale -> ${locale}`);
    return true;
  }

  return { apply, getLocale, initializeFromApp };
}

module.exports = { createShellLocaleRuntime, readAppLocale };
