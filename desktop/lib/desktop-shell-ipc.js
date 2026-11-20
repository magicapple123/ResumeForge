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
const { normalizeShellLocale } = require("./shell-locale");
const { createLaunchAtLogin } = require("./launch-at-login");

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
  // 应用内语言（不是系统语言）：渲染进程 React 挂载后把当前 locale 推过来，
  // 主进程据此重建托盘菜单 / tooltip 与窗口标题兜底。
  setLocale: "desktop:set-locale",
  // WF-20：设置项「托盘图标跟随系统主题」的开关（默认关）。单向、只收布尔。
  trayFollowSystem: "desktop:set-tray-follow-system",
  // WF-08 第三处联动：开机自启。两条都是**读写系统真相**（HKCU\...\Run），
  // 应用内不存第二份布尔（见 lib/launch-at-login.js 顶部说明）。
  getLaunchAtLogin: "desktop:get-launch-at-login",
  setLaunchAtLogin: "desktop:set-launch-at-login",
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
 * @param {function(): ("zh" | "en")} [deps.getShellLocale] 当前壳层语言（菜单错误文案用）
 * @param {function("zh" | "en"): void} [deps.onShellLocaleChanged] 语言切换后的重建入口
 *   （由 main.js 装配：托盘菜单 + tooltip + 窗口标题；本模块只管通道校验与分发）
 * @param {function(object): object} [deps.getShellTheme] 主题裁决句柄（lib/shell-theme.js），
 *   提供 setAppTheme / setFollowSystem；缺省时主题只作用于标题栏
 * @param {function(string): void} [deps.logLine] */
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
    getShellLocale = () => "en",
    onShellLocaleChanged,
    getShellTheme,
    logLine = () => {},
  } = deps;

  // WF-08：开机自启默认自己造（读写 HKCU\...\Run）；deps 传了就用注入的（测试用）。
  const launchAtLogin = deps.launchAtLogin || createLaunchAtLogin({ app, logLine });

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
    getLocale: getShellLocale,
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
    if (!trusted(event)) return;
    titleBar.applyTheme(theme);
    // 同一个上报还有第二个消费者：托盘图标（WF-20）。标题栏只关心 win32/linux 的
    // 覆盖层配色，托盘在每个平台都要跟着换图。
    const shellTheme = typeof getShellTheme === "function" ? getShellTheme() : null;
    if (shellTheme) shellTheme.setAppTheme(theme === "dark" ? "dark" : "light");
  });

  // WF-20 兜底开关：只看布尔，不接收任意载荷。开关本身存在后端（注册表出厂值 false），
  // 主进程不读数据库，所以每次挂载/切换都由渲染层推一次。
  ipcMain.on(CHANNELS.trayFollowSystem, (event, value) => {
    if (!trusted(event)) return;
    const shellTheme = typeof getShellTheme === "function" ? getShellTheme() : null;
    if (shellTheme) shellTheme.setFollowSystem(Boolean(value));
  });

  // WF-08：开机自启（读写 HKCU\...\Run 的 ResumeForge 值）。
  // 不在 deps 里注入实现时两条通道都不注册 —— 旧壳/测试环境不会出现"点了没反应"的假开关。
  if (typeof ipcMain.handle === "function") {
    ipcMain.handle(CHANNELS.getLaunchAtLogin, (event) => {
      if (!trusted(event)) return { supported: false, enabled: false };
      try {
        return launchAtLogin.read();
      } catch (err) {
        logLine(`launch-at-login read failed: ${err}`);
        return { supported: false, enabled: false };
      }
    });
    ipcMain.handle(CHANNELS.setLaunchAtLogin, (event, value) => {
      if (!trusted(event)) return { supported: false, enabled: false };
      try {
        return launchAtLogin.write(Boolean(value));
      } catch (err) {
        logLine(`launch-at-login write failed: ${err}`);
        return { supported: false, enabled: false };
      }
    });
  }

  // 应用内语言：只接受 "zh" / "en"（其它值静默忽略，渲染层传错不会影响壳层状态）。
  // 收到后交给 main.js 重建主进程侧的用户可见文案：托盘菜单 + tooltip、主窗口标题
  // （运行时标题由渲染层 RouteAccessibility 接管，这里只是切换瞬间的兜底），
  // 以及下一次打开关闭卡片时使用的语言。已打开的关闭卡片不热切换（见 close-dialog.js）。
  ipcMain.on(CHANNELS.setLocale, (event, value) => {
    if (!trusted(event)) return;
    const locale = normalizeShellLocale(value);
    if (!locale) return;
    if (typeof onShellLocaleChanged === "function") onShellLocaleChanged(locale);
  });

  return { menu, channels: CHANNELS };
}

module.exports = { CHANNELS, isMainWindowSender, registerDesktopShellIpc };
