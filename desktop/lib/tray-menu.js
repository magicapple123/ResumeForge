// SPDX-License-Identifier: Apache-2.0
"use strict";

// 托盘菜单（问题清单 §18.2-C 的恢复入口 + §19 保持原生 Menu）。
//
// 托盘必须是原生 Menu（React 画不出来），所以它和标题栏的 React 菜单是**两套**，
// 但决策只有一处：菜单结构按 getRemembered() 现算，"勾上即清掉记忆"由
// close-behavior 的 clearRemembered 完成，这里只负责重建菜单让勾选态回到真相。
//
// 文案跟随应用内语言（lib/shell-locale.js）：模板每次构造时按 getLocale() 现查表，
// 语言切换时重建一次菜单即可（main.js 的 desktop:set-locale 处理器调用 refresh，
// tooltip 与菜单项在同一次重建里一起换）。
//
// 模板构造函数是纯函数（不 new Tray），离线用例可以只断言结构与点击行为。

const { t } = require("./shell-locale");

/**
 * 托盘新增的四项（Q11）：**不重写实现**，全部走 `registerDesktopShellIpc` 返回的
 * `menu.run(id)`——那是渲染层菜单的同一条链路，动作 id 也就必须是它认的那些。
 *
 * 「检查更新」特殊：现有链路把结果交回渲染层的「关于」弹窗，托盘侧没有消费者。
 * 所以先 `showWindow()` 把主窗口唤到前台再走既有流程，否则用户点了像没反应。
 *
 * 这里只存用途键：翻译只能在构造模板时求值（模块作用域求值会锁死语言）。
 */
const TRAY_ACTION_ITEMS = [
  { labelKey: "tray.openDataDir", action: "file.openDataDir" },
  { labelKey: "tray.openLogDir", action: "help.openLogDir" },
  { labelKey: "tray.diagnostics", action: "help.getDiagnostics" },
  // `focusWindow: true` 的项＝结果要在界面上看，必须先唤起窗口。
  { labelKey: "tray.checkUpdate", action: "help.checkUpdate", focusWindow: true },
];

/**
 * 当前语言下的托盘文案（菜单项 + tooltip）。
 *
 * refresh 与离线用例共用这一张表：两处各拼一遍一定会漂移（例如加了新菜单项忘记
 * 换语言），所以导出它给用例断言"每个键都真的被用上"。
 *
 * @param {"zh" | "en"} locale
 */
function trayLabelsFor(locale) {
  return {
    open: t(locale, "tray.open"),
    openDataDir: t(locale, "tray.openDataDir"),
    openLogDir: t(locale, "tray.openLogDir"),
    diagnostics: t(locale, "tray.diagnostics"),
    checkUpdate: t(locale, "tray.checkUpdate"),
    askOnClose: t(locale, "tray.askOnClose"),
    quit: t(locale, "tray.quit"),
    tooltip: t(locale, "tray.tooltip"),
  };
}

/** 依赖里取当前语言；没注入时按英文（壳层缺省语言）兜底。 */
function currentLocale(deps) {
  return typeof deps.getLocale === "function" ? deps.getLocale() : "en";
}

/**
 * 构造托盘菜单模板。
 *
 * @param {object} deps
 * @param {function(): (object|null)} deps.getWindow 当前主窗口
 * @param {object} deps.app Electron app（退出只发 app.quit()）
 * @param {function(): (string|null)} deps.getRemembered 当前"记住的关闭行为"
 * @param {function(): void} deps.clearRemembered 清掉记忆（恢复每次询问）
 * @param {function(): void} deps.refresh 重建托盘菜单
 * @param {function(): ("zh" | "en")} [deps.getLocale] 当前壳层语言
 * @param {function(string): void} [deps.runMenuAction] 走注册好的菜单动作分发器
 */
function buildTrayTemplate(deps) {
  const { getWindow, app, getRemembered, clearRemembered, refresh, runMenuAction } = deps;
  const labels = trayLabelsFor(currentLocale(deps));

  const showWindow = () => {
    const win = getWindow();
    if (!win) return;
    try {
      win.show();
      win.focus();
    } catch {
      // 窗口已销毁（退出流程中）：恢复动作静默失败即可。
    }
  };

  const actionItems =
    typeof runMenuAction === "function"
      ? TRAY_ACTION_ITEMS.map((item) => ({
          label: t(currentLocale(deps), item.labelKey),
          click: () => {
            if (item.focusWindow) showWindow();
            runMenuAction(item.action);
          },
        }))
      : [];

  return [
    { label: labels.open, click: showWindow },
    ...(actionItems.length > 0 ? [{ type: "separator" }, ...actionItems] : []),
    { type: "separator" },
    {
      label: labels.askOnClose,
      type: "checkbox",
      // 状态取自"没有记忆"：有记忆时 unchecked，点一下（勾上）即清掉记忆恢复询问。
      checked: !getRemembered(),
      click: (item) => {
        if (item && item.checked) {
          // clearRemembered 在 main.js 里会触发 onPreferenceChanged -> refresh，
          // 这里不再重建一次（否则每点一下刷两次菜单）。
          clearRemembered();
          return;
        }
        // 取消勾选没有可执行语义（记一个"不询问"等于替用户做决定）：重建菜单
        // 让勾选态回到"是否已记住"，而不是停在用户刚点出来的假状态。
        refresh();
      },
    },
    { type: "separator" },
    {
      label: labels.quit,
      click: () => {
        // 不在这里短路 quitting：app.quit() 触发 before-quit，唯一停止点在那里
        //（审计 PR-05：继续遵守"托盘退出不走捷径"的既有约定）。
        app.quit();
      },
    },
  ];
}

/**
 * 托盘生命周期（创建 / 重建 / 销毁）。
 *
 * @param {object} deps
 * @param {function(string): object} deps.Tray Electron Tray 构造器
 * @param {object} deps.Menu Electron Menu（buildFromTemplate）
 * @param {string} deps.iconPath 托盘图标（窗口图标同源）
 * @param {object} deps.app Electron app
 * @param {function(): (object|null)} deps.getWindow
 * @param {function(): (string|null)} deps.getRemembered
 * @param {function(): void} deps.clearRemembered
 * @param {function(): ("zh" | "en")} [deps.getLocale] 当前壳层语言
 * @param {function(string): void} [deps.runMenuAction]
 * @param {function(string): void} [deps.logLine]
 */
function createTrayManager(deps) {
  const { Tray, Menu, iconPath, app, getWindow, getRemembered, clearRemembered } = deps;
  const { runMenuAction, logLine = () => {} } = deps;
  let tray = null;

  /** 重建菜单并同步 tooltip：语言切换与勾选态变化都走这里，保证两者永远同源。 */
  function refresh() {
    if (!tray) return;
    try {
      tray.setContextMenu(
        Menu.buildFromTemplate(
          buildTrayTemplate({
            getWindow,
            app,
            getRemembered,
            clearRemembered,
            refresh,
            runMenuAction,
            getLocale: () => currentLocale(deps),
          }),
        ),
      );
    } catch (err) {
      logLine(`tray: rebuild menu failed: ${err}`);
    }
    try {
      tray.setToolTip(t(currentLocale(deps), "tray.tooltip"));
    } catch {
      // 旧版本/无托盘环境没有 setToolTip：菜单仍然可用。
    }
  }

  function showWindow() {
    const win = getWindow();
    if (!win) return;
    try {
      win.show();
      win.focus();
    } catch {
      // 同 buildTrayTemplate.showWindow。
    }
  }

  function create() {
    tray = new Tray(iconPath);
    refresh();
    // 左键也唤起窗口（Windows 惯例）。
    tray.on("click", showWindow);
  }

  function destroy() {
    if (!tray) return;
    try {
      tray.destroy();
    } catch {
      // 退出路径上销毁失败无所谓：进程马上就没了。
    }
    tray = null;
  }

  return { create, refresh, destroy, getTray: () => tray };
}

module.exports = { TRAY_ACTION_ITEMS, buildTrayTemplate, createTrayManager, trayLabelsFor };
