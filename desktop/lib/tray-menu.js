// SPDX-License-Identifier: Apache-2.0
"use strict";

// 托盘菜单（问题清单 §18.2-C 的恢复入口 + §19 保持原生 Menu）。
//
// 托盘必须是原生 Menu（React 画不出来），所以它和标题栏的 React 菜单是**两套**，
// 但决策只有一处：菜单结构按 getRemembered() 现算，"勾上即清掉记忆"由
// close-behavior 的 clearRemembered 完成，这里只负责重建菜单让勾选态回到真相。
//
// 模板构造函数是纯函数（不 new Tray），离线用例可以只断言结构与点击行为。

const TRAY_LABELS = {
  open: "打开简历通",
  openDataDir: "打开数据目录",
  openLogDir: "打开日志目录",
  diagnostics: "复制诊断信息",
  checkUpdate: "检查更新",
  askOnClose: "关闭窗口时询问",
  quit: "退出",
};

/**
 * 托盘新增的四项（Q11）：**不重写实现**，全部走 `registerDesktopShellIpc` 返回的
 * `menu.run(id)`——那是渲染层菜单的同一条链路，动作 id 也就必须是它认的那些。
 *
 * 「检查更新」特殊：现有链路把结果交回渲染层的「关于」弹窗，托盘侧没有消费者。
 * 所以先 `showWindow()` 把主窗口唤到前台再走既有流程，否则用户点了像没反应。
 */
const TRAY_ACTIONS = [
  { label: TRAY_LABELS.openDataDir, action: "file.openDataDir" },
  { label: TRAY_LABELS.openLogDir, action: "help.openLogDir" },
  { label: TRAY_LABELS.diagnostics, action: "help.getDiagnostics" },
  // `focusWindow: true` 的项＝结果要在界面上看，必须先唤起窗口。
  { label: TRAY_LABELS.checkUpdate, action: "help.checkUpdate", focusWindow: true },
];

/**
 * 构造托盘菜单模板。
 *
 * @param {object} deps
 * @param {function(): (object|null)} deps.getWindow 当前主窗口
 * @param {object} deps.app Electron app（退出只发 app.quit()）
 * @param {function(): (string|null)} deps.getRemembered 当前"记住的关闭行为"
 * @param {function(): void} deps.clearRemembered 清掉记忆（恢复每次询问）
 * @param {function(): void} deps.refresh 重建托盘菜单
 */
function buildTrayTemplate(deps) {
  const { getWindow, app, getRemembered, clearRemembered, refresh, runMenuAction } = deps;

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
      ? TRAY_ACTIONS.map((item) => ({
          label: item.label,
          click: () => {
            if (item.focusWindow) showWindow();
            runMenuAction(item.action);
          },
        }))
      : [];

  return [
    { label: TRAY_LABELS.open, click: showWindow },
    ...(actionItems.length > 0 ? [{ type: "separator" }, ...actionItems] : []),
    { type: "separator" },
    {
      label: TRAY_LABELS.askOnClose,
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
      label: TRAY_LABELS.quit,
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
 * @param {function(string): void} [deps.logLine]
 */
function createTrayManager(deps) {
  const {
    Tray,
    Menu,
    iconPath,
    app,
    getWindow,
    getRemembered,
    clearRemembered,
    runMenuAction,
    logLine = () => {},
  } = deps;
  let tray = null;

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
          }),
        ),
      );
    } catch (err) {
      logLine(`tray: rebuild menu failed: ${err}`);
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
    try {
      tray.setToolTip("简历通");
    } catch {
      // 旧版本/无托盘环境没有 setToolTip：菜单仍然可用。
    }
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

module.exports = { TRAY_ACTIONS, TRAY_LABELS, buildTrayTemplate, createTrayManager };
