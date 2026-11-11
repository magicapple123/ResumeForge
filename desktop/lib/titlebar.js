// SPDX-License-Identifier: Apache-2.0
"use strict";

// 自绘标题栏的**窗口壳层**（问题清单 §19）：electron-builder 窗口选项、标题栏覆盖层
// 配色与窗口状态通知。React 渲染层在 frontend/src/components/desktop/，本模块只负责
// 主进程那一半，方便离线断言（颜色 / 高度 / 平台分支 / 无窗口时的静默）。
//
// 三条硬约束：
//   1. 三颗窗口按钮由系统绘制（titleBarStyle: "hidden" + titleBarOverlay），不自己画；
//      标题栏覆盖层颜色必须与应用自绘标题栏背景逐值一致，否则深浅色下都会出现色块；
//   2. macOS 的红绿灯在左上角：只给 trafficLightPosition，不给 overlay（overlay 仅
//      win32/linux 支持），React 侧给菜单区加左内边距；
//   3. 主题切换时主进程要同步 setTitleBarOverlay，否则深色界面顶着浅色按钮条。

/** 自绘标题栏高度（与 React 侧 CSS / WCO overlay 高度必须同值）。 */
const TITLEBAR_HEIGHT = 32;

/**
 * 兜底 padding 的 CSS。
 *
 * **本常量必须与 `TITLEBAR_HEIGHT` 同源，二者又必须与前端 `--rf-titlebar-height`（32px，
 * 定义在 frontend/src/styles/desktop-titlebar.css）逐值一致。** 只要有一个漂移，兜底层
 * 就会让页面要么差一条 32px 的缝，要么继续与系统三颗按钮互相遮挡（P1-1 症状）。
 * 所以这里从 TITLEBAR_HEIGHT 拼字符串，绝不写字面量 32。
 */
function titleBarFallbackCss(height = TITLEBAR_HEIGHT) {
  return `body{padding-top:${height}px}`;
}

/**
 * 标题栏覆盖层配色：与应用 CSS 的 `--rf-titlebar-bg` 逐值一致（浅 #f5f7fa / 深 #151b23）。
 * symbolColor 取对应主题的正文色系，保证最小化/最大化/关闭图标在两种底色上都清晰。
 */
const TITLEBAR_THEME = {
  light: { color: "#f5f7fa", symbolColor: "#3d4a5c" },
  dark: { color: "#151b23", symbolColor: "#c9d4e0" },
};

/** "system" 之类无法判定的值一律按浅色（应用初始主题也是浅色，避免启动闪深）。 */
function normalizeTheme(theme) {
  return theme === "dark" ? "dark" : "light";
}

/** 覆盖层选项：颜色随主题，高度恒为 32px（不再跟随系统标题栏高度）。 */
function titleBarOverlayFor(theme) {
  const colors = TITLEBAR_THEME[normalizeTheme(theme)];
  return { color: colors.color, symbolColor: colors.symbolColor, height: TITLEBAR_HEIGHT };
}

/** titleBarOverlay 只有 Windows / Linux 支持；macOS 走红绿灯位置。 */
function supportsOverlay(platform) {
  return platform === "win32" || platform === "linux";
}

/**
 * BrowserWindow 的窗口壳选项（纯函数，可按平台断言）。
 * 不传 frame: false——titleBarStyle: "hidden" 在三个平台都保留窗口圆角/阴影/贴靠等系统行为。
 */
function windowChromeOptions({ platform = process.platform } = {}) {
  const options = { titleBarStyle: "hidden" };
  if (supportsOverlay(platform)) {
    options.titleBarOverlay = titleBarOverlayFor("light");
  } else if (platform === "darwin") {
    // 红绿灯默认贴左上角、会压在菜单文字上；React 侧同时留 78px 左内边距。
    options.trafficLightPosition = { x: 12, y: 10 };
  }
  return options;
}

/**
 * 主进程侧的标题栏控制器：窗口创建后读状态、主题变化时重刷覆盖层。
 *
 * @param {object} deps
 * @param {function(): (object|null)} deps.getWindow 当前主窗口
 * @param {string} [deps.platform] process.platform 的可注入替身
 * @param {function(string): void} [deps.logLine] 诊断日志
 */
function createTitleBarController(deps) {
  const { getWindow, platform = process.platform, logLine = () => {} } = deps;

  function liveWindow() {
    const win = getWindow();
    if (!win) return null;
    try {
      return win.isDestroyed() ? null : win;
    } catch {
      return null;
    }
  }

  /** 主题切换（渲染进程经 IPC 上报）：非 win32/linux 或 API 缺失时静默跳过。 */
  function applyTheme(theme) {
    if (!supportsOverlay(platform)) return false;
    const win = liveWindow();
    if (!win || typeof win.setTitleBarOverlay !== "function") return false;
    try {
      win.setTitleBarOverlay(titleBarOverlayFor(theme));
      return true;
    } catch (err) {
      logLine(`titlebar: setTitleBarOverlay failed: ${err}`);
      return false;
    }
  }

  /** 当前窗口状态快照：渲染层用它在菜单里显示"最大化"还是"还原"，以及全屏时隐藏标题栏。 */
  function windowState() {
    const win = liveWindow();
    if (!win) return { maximized: false, fullscreen: false };
    try {
      return {
        maximized: Boolean(win.isMaximized && win.isMaximized()),
        fullscreen: Boolean(win.isFullScreen && win.isFullScreen()),
      };
    } catch {
      return { maximized: false, fullscreen: false };
    }
  }

  /** 最大化 / 还原 / 全屏状态变化时推给渲染层（React 菜单文案随之切换）。 */
  function sendWindowState() {
    const win = liveWindow();
    if (!win) return;
    try {
      win.webContents.send("desktop:window-state", windowState());
    } catch (err) {
      logLine(`titlebar: window state push failed: ${err}`);
    }
  }

  return {
    windowOptions: () => windowChromeOptions({ platform }),
    applyTheme,
    windowState,
    sendWindowState,
  };
}

/**
 * P1-1 方案 3 的最后一层兜底：加载完成后检查 `.app-titlebar` 到底有没有渲染出来。
 *
 * 为什么主进程也要管这件事：前两层（分流条件看 `window.splash.isDesktop`、`data-hidden`
 * 只信真实全屏事件）都在渲染层，而用户报的形态是"页面内容从 y=0 开始、三颗系统按钮压
 * 在页头/制作台操作条上、点击被吞（误点 = 最小化/关闭）"。一旦渲染层因为任何原因没渲染
 * 出标题栏（旧 dist、渲染异常、桥缺失），主进程是唯一还能补救的地方——补一条 padding，
 * 让内容整体让开 32px。补不上最多多一条缝，不补就是误关窗口。
 *
 * @param {object} deps
 * @param {object} deps.webContents 目标 webContents（需有 executeJavaScript / insertCSS）
 * @param {function(string): void} [deps.logLine] 诊断日志（写 desktop-main.log）
 * @returns {Promise<boolean>} true = 打了兜底
 */
function padForMissingTitleBar(deps) {
  const { webContents, logLine = () => {} } = deps || {};
  if (!webContents || typeof webContents.executeJavaScript !== "function") {
    return Promise.resolve(false);
  }
  return Promise.resolve(
    webContents.executeJavaScript("document.querySelector('.app-titlebar') !== null", true),
  )
    .then((present) => {
      if (present) return false;
      // warning 级别：启动器与壳的诊断都是按 warning 收的，info 会被整条吞掉。
      logLine(
        `titlebar: .app-titlebar missing after load; applying ${TITLEBAR_HEIGHT}px body padding fallback`,
      );
      if (typeof webContents.insertCSS !== "function") return true;
      return Promise.resolve(webContents.insertCSS(titleBarFallbackCss())).then(() => true);
    })
    .catch((err) => {
      logLine(`titlebar: missing-titlebar check failed: ${err}`);
      return false;
    });
}

/**
 * 把上面那层兜底挂到**下一次** `did-finish-load` 上（在 loadURL 之前调用）。
 *
 * 挂在事件上而不是 loadURL 之后直接执行：loadURL 的 Promise 与 did-finish-load 的先后
 * 依赖 Electron 版本，而"document 已经就绪"是这条检查成立的前提。
 */
function installTitleBarFallbackOnLoad(deps) {
  const { webContents, logLine = () => {} } = deps || {};
  if (!webContents || typeof webContents.once !== "function") return;
  webContents.once("did-finish-load", () => {
    void padForMissingTitleBar({ webContents, logLine });
  });
}

module.exports = {
  TITLEBAR_HEIGHT,
  TITLEBAR_THEME,
  normalizeTheme,
  titleBarOverlayFor,
  titleBarFallbackCss,
  supportsOverlay,
  windowChromeOptions,
  createTitleBarController,
  padForMissingTitleBar,
  installTitleBarFallbackOnLoad,
};
