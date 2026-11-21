// SPDX-License-Identifier: Apache-2.0
"use strict";

// 托盘（§18.2-C 的恢复入口 + §19 的常驻形态）。
//
// 2026-11-20 起托盘右键菜单是**自绘**的（`desktop/tray-menu.html` +
// `lib/tray-menu-window.js`）：原生 Menu 的内边距/勾选列/行高 Electron 完全不暴露，
// 菜单项左端被一条永久预留的勾选列推开、卡片整体过宽。所以这里只产出**纯数据模型**
// —— `buildMenuModel()` 返回 `[{ id, type, label, checked?, danger?, disabled? }]`，
// HTML 渲染与离线用例吃同一份数据，不必启动 Electron。
//
// 决策仍只有一处：模型按 `getAsk()` 现算（"关闭窗口时询问"从此是真开关，不再
// 反射"有没有记住关闭行为"）；动作交给 `choose(id)`，它和标题栏菜单走同一条
// `runMenuAction` 分发链路。
//
// 文案跟随应用内语言（lib/shell-locale.js）：模型每次打开时按 `getLocale()` 现查表，
// 所以切换语言后**不需要**重建任何东西 —— 下次打开自然就是新语言。
//
// 本模块不 require("electron")，用例可以直接构造假 Tray。

const fs = require("node:fs");
const path = require("node:path");
const { t } = require("./shell-locale");

/**
 * 托盘新增的四项（Q11）：**不重写实现**，全部走 `registerDesktopShellIpc` 返回的
 * 动作分发器 `run(id)`——那是渲染层菜单的同一条链路，动作 id 也就必须是它认的那些。
 *
 * 「检查更新」特殊：现有链路把结果交回渲染层的「关于」弹窗，托盘侧没有消费者。
 * 所以先 `showWindow()` 把主窗口唤到前台再走既有流程，否则用户点了像没反应。
 *
 * `id` 直接用动作 id：模型、HTML 回执、`choose()` 三处的键因此不可能漂移。
 * `icon` 是**前置图标位的键**（2026-11-20 第 1 条）：QQ 式菜单每行都必须有一个
 * 16px 图标位，文字列才会永远对齐。键的取值必须能在 `desktop/tray-menu.html` 的
 * `ICONS` 表里找到（除了 `box`，它按勾选态映射到 `boxOn` / `boxOff`）。
 */
const TRAY_ACTION_ITEMS = [
  { id: "file.openDataDir", labelKey: "tray.openDataDir", icon: "folder" },
  { id: "help.openLogDir", labelKey: "tray.openLogDir", icon: "file" },
  { id: "help.getDiagnostics", labelKey: "tray.diagnostics", icon: "copy" },
  // `focusWindow: true` 的项＝结果要在界面上看，必须先唤起窗口。
  { id: "help.checkUpdate", labelKey: "tray.checkUpdate", icon: "refresh", focusWindow: true },
];

/**
 * 固定 id → 前置图标键。
 *
 * 单独一张表（而不是散在 buildMenuModel 的字面量里）是为了让用例能一次性断言
 * "每个菜单项都有图标"：漏一个就等于那一行文字又被推歪了。
 */
const MENU_ICONS = Object.freeze({
  open: "win",
  openDataDir: "folder",
  openLogDir: "file",
  diagnostics: "copy",
  checkUpdate: "refresh",
  // 开关行用勾选框**当作**它的图标位（见 tray-menu.html 的 boxOn / boxOff）。
  askOnClose: "box",
  quit: "power",
});

/** 模型里的固定 id（HTML 与用例都按它认项，改名字要一起改）。 */
const MENU_IDS = {
  open: "open",
  askOnClose: "askOnClose",
  quit: "quit",
  actionsSeparator: "separator-actions",
  askSeparator: "separator-ask",
  quitSeparator: "separator-quit",
};

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
 * 托盘图标（多尺寸 ICO，16/20/24/32/48/64 帧）。
 *
 * 打包态读 extraResources 的那一份（Tray 读 asar 内的 ICO 不可靠），开发态读 desktop/
 * 根。图标**固定**这一枚浅色版：不再随任务栏明暗换图（2026-11-20 用户决定）。
 *
 * @param {object} deps
 * @param {object} deps.app Electron app（isPackaged）
 * @param {string} deps.dirname 开发态 desktop/ 目录
 * @param {function(): string} [deps.resourcesPath] 打包态 resources 目录
 */
function resolveTrayIconPath(deps) {
  const { app, dirname, resourcesPath = () => process.resourcesPath } = deps;
  const base = app && app.isPackaged ? resourcesPath() : dirname;
  // 首选 tray.ico；打包漏了它时退回同目录的 icon.png（PNG 同样能当托盘图标）。
  // 两个都不在就返回首选路径，交给 create() 的 try/catch 兜底——托盘是附带功能，
  // 不该让它把整个应用按在启动失败页。2.2.0 的 Linux AppImage 就栽在这里：
  // `Failed to load image from path '.../resources/tray.ico'`。
  const candidates = [path.join(base, "tray.ico"), path.join(base, "icon.png")];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // 读不到就试下一个
    }
  }
  return candidates[0];
}

/**
 * 托盘菜单模型（纯数据，可直接喂给 `tray-menu.html`）。
 *
 * @param {object} deps
 * @param {function(): boolean} [deps.getAsk] 「关闭窗口时询问」当前开关
 * @param {function(): ("zh" | "en")} [deps.getLocale] 当前壳层语言
 * @param {function(string): void} [deps.runMenuAction] 动作分发器是否存在
 *   （缺失时四项标 `disabled`，而不是从模型里消失——菜单高度不会跳）
 * @returns {Array<{id: string, type: "item" | "separator", label?: string, icon?: string,
 *   checked?: boolean, danger?: boolean, disabled?: boolean}>}
 */
function buildMenuModel(deps = {}) {
  const locale = currentLocale(deps);
  const labels = trayLabelsFor(locale);
  const actionsAvailable = typeof deps.runMenuAction === "function";
  const ask = typeof deps.getAsk === "function" ? deps.getAsk() : true;

  return [
    { id: MENU_IDS.open, type: "item", label: labels.open, icon: MENU_ICONS.open },
    { id: MENU_IDS.actionsSeparator, type: "separator" },
    ...TRAY_ACTION_ITEMS.map((item) => ({
      id: item.id,
      type: "item",
      label: t(locale, item.labelKey),
      icon: item.icon,
      disabled: !actionsAvailable,
    })),
    { id: MENU_IDS.askSeparator, type: "separator" },
    {
      id: MENU_IDS.askOnClose,
      type: "item",
      label: labels.askOnClose,
      icon: MENU_ICONS.askOnClose,
      checked: Boolean(ask),
    },
    { id: MENU_IDS.quitSeparator, type: "separator" },
    { id: MENU_IDS.quit, type: "item", label: labels.quit, icon: MENU_ICONS.quit, danger: true },
  ];
}

/**
 * 托盘生命周期（创建 / 刷新 tooltip / 右键打开自绘菜单 / 销毁）。
 *
 * @param {object} deps
 * @param {function(string): object} deps.Tray Electron Tray 构造器
 * @param {string} deps.iconPath 托盘图标（`resolveTrayIconPath` 的结果，固定浅色版）
 * @param {object} deps.app Electron app（退出只发 app.quit()）
 * @param {function(): (object|null)} deps.getWindow
 * @param {function(): boolean} [deps.getAsk] 「关闭窗口时询问」
 * @param {function(boolean): void} [deps.setAsk] 写开关（勾选/取消勾选）
 * @param {function(string): void} [deps.runMenuAction] 动作分发器
 * @param {function({model: Array, anchor: object|null}): void} [deps.openMenu]
 *   打开自绘菜单（lib/tray-menu-window.js）；缺失时右键不做任何事
 * @param {function(): ("zh" | "en")} [deps.getLocale] 当前壳层语言
 * @param {function(string): void} [deps.logLine]
 */
function createTrayManager(deps) {
  const {
    Tray,
    iconPath,
    app,
    getWindow,
    getAsk = () => true,
    setAsk = () => {},
    runMenuAction,
    openMenu,
    getLocale,
    logLine = () => {},
  } = deps;
  let tray = null;

  function model() {
    return buildMenuModel({ getAsk, getLocale, runMenuAction });
  }

  /**
   * 刷新：只同步 tooltip。
   *
   * 菜单**不再**在 `refresh()` 里重建 —— 模型是打开那一刻现算的（语言切换 / 勾选
   * 变化都自然生效），这也正是"取消勾选不再是假动作"的前提。
   */
  function refresh() {
    if (!tray) return;
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
      // 窗口已销毁（退出流程中）：恢复动作静默失败即可。
    }
  }

  function trayBounds() {
    try {
      return tray && typeof tray.getBounds === "function" ? tray.getBounds() : null;
    } catch {
      return null;
    }
  }

  /** 右键：打开自绘菜单（模型在这一刻生成）。 */
  function openContextMenu() {
    if (typeof openMenu !== "function") {
      logLine("tray: menu window unavailable");
      return;
    }
    try {
      openMenu({ model: model(), anchor: trayBounds() });
    } catch (err) {
      logLine(`tray: open menu failed: ${err}`);
    }
  }

  /**
   * 执行模型里的一项（HTML 回执走这里，用例也直接调它）。
   *
   * 勾选项在**主进程**翻转：渲染层只负责把"用户点了这一项"报上来，状态真相
   * 永远是 close-behavior 的那份 preference，避免"看起来勾上了、关窗还在问"。
   */
  function choose(id) {
    if (id === MENU_IDS.open) {
      showWindow();
      return;
    }
    if (id === MENU_IDS.askOnClose) {
      setAsk(!getAsk());
      refresh();
      return;
    }
    if (id === MENU_IDS.quit) {
      // 不在这里短路 quitting：app.quit() 触发 before-quit，唯一停止点在那里
      //（审计 PR-05：继续遵守"托盘退出不走捷径"的既有约定）。
      app.quit();
      return;
    }
    const item = TRAY_ACTION_ITEMS.find((entry) => entry.id === id);
    if (!item) {
      logLine(`tray: unknown menu id: ${id}`);
      return;
    }
    if (item.focusWindow) showWindow();
    if (typeof runMenuAction === "function") runMenuAction(item.id);
  }

  function create() {
    try {
      tray = new Tray(iconPath);
    } catch (err) {
      // 图标缺失或格式不受支持时不要让启动失败：记一行日志，托盘缺席，
      // 窗口、后端与其余功能照常（其余调用点都已判 null）。
      tray = null;
      logLine(`tray unavailable (${iconPath}): ${err && err.message ? err.message : err}`);
      return;
    }
    refresh();
    // 左键唤起窗口（Windows 惯例），右键出自绘菜单。
    tray.on("click", showWindow);
    tray.on("right-click", openContextMenu);
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

  return {
    create,
    refresh,
    destroy,
    choose,
    getMenuModel: model,
    openContextMenu,
    getTray: () => tray,
  };
}

module.exports = {
  MENU_ICONS,
  MENU_IDS,
  TRAY_ACTION_ITEMS,
  buildMenuModel,
  createTrayManager,
  resolveTrayIconPath,
  trayLabelsFor,
};
