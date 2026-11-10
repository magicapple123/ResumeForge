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

module.exports = {
  TITLEBAR_HEIGHT,
  TITLEBAR_THEME,
  normalizeTheme,
  titleBarOverlayFor,
  supportsOverlay,
  windowChromeOptions,
  createTitleBarController,
};
