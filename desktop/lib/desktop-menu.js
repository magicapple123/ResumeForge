// SPDX-License-Identifier: Apache-2.0
"use strict";

// 标题栏菜单的**主进程动作表**（问题清单 §19.3）：编辑 / 视图 / 窗口 / 文件目录类
// 动作走 IPC，渲染层只发动作 id，不认识 Electron API。URL 一律用本文件的固定常量，
// 渲染层不能传任意 URL 给 shell.openExternal（contextIsolation 下的最小暴露面）。
//
// 不 require("electron")：desktop 的离线用例可以注入假 app / window / shell 断言
// 每个动作真的落在对应 API 上，以及「关闭窗口」走窗口 close handler（第 18 条）。

/** 关于弹窗里的三个外链：固定值，只认这三个 key。 */
const EXTERNAL_URLS = {
  github: "https://github.com/magicapple123/ResumeForge",
  website: "https://magicapple123.github.io/ResumeForge-official/",
  license: "https://github.com/magicapple123/ResumeForge/blob/main/LICENSE",
};

/** 缩放档位：与 lib/window-state.js 的 [0.8, 1.5] 验收区间一致（步长 0.1）。 */
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

function clampZoom(value) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

/**
 * 动作表工厂。
 *
 * @param {object} deps
 * @param {object} deps.app Electron app（getVersion）
 * @param {function(): (object|null)} deps.getWindow 当前主窗口
 * @param {object} deps.shell Electron shell（openPath / openExternal）
 * @param {function(): string} deps.getDataDir 用户数据目录（ADR-0004：打包态在用户目录）
 * @param {function(): (string|null)} deps.getLogDir 诊断日志目录（不可写时 null）
 * @param {function(): void} deps.runUpdateCheck 手动检查更新（updater.js 的入口）
 * @param {string} [deps.platform] process.platform 的可注入替身
 * @param {function(string): void} [deps.logLine] 诊断日志
 */
function createDesktopMenuActions(deps) {
  const {
    app,
    getWindow,
    shell,
    getDataDir,
    getLogDir,
    runUpdateCheck,
    platform = process.platform,
    logLine = () => {},
  } = deps;

  function liveWindow() {
    const win = getWindow();
    if (!win) return null;
    try {
      return win.isDestroyed() ? null : win;
    } catch {
      return null;
    }
  }

  function webContents() {
    const win = liveWindow();
    return win && win.webContents ? win.webContents : null;
  }

  function requireWindow() {
    const win = liveWindow();
    if (!win) throw new Error("主窗口不可用");
    return win;
  }

  function openPath(target) {
    if (!target) throw new Error("目录不可用");
    // openPath 用"返回错误字符串"而不是 reject 来报告失败；这里统一成异常，
    // 让渲染层拿到 ok:false（打不开目录不该静默）。
    return Promise.resolve(shell.openPath(target)).then((error) => {
      if (error) throw new Error(error);
    });
  }

  function openExternal(key) {
    const url = EXTERNAL_URLS[key];
    if (!url) throw new Error(`未知外链: ${key}`);
    return Promise.resolve(shell.openExternal(url));
  }

  function zoom(delta) {
    const wc = webContents();
    if (!wc || typeof wc.getZoomFactor !== "function" || typeof wc.setZoomFactor !== "function") {
      return;
    }
    wc.setZoomFactor(clampZoom(wc.getZoomFactor() + delta));
  }

  const handlers = {
    // ---- 编辑：自绘菜单用不了 role，改调 webContents 的同名方法 ----
    "edit.undo": () => webContents()?.undo(),
    "edit.redo": () => webContents()?.redo(),
    "edit.cut": () => webContents()?.cut(),
    "edit.copy": () => webContents()?.copy(),
    "edit.paste": () => webContents()?.paste(),
    "edit.selectAll": () => webContents()?.selectAll(),
    // ---- 视图 ----
    "view.zoomIn": () => zoom(ZOOM_STEP),
    "view.zoomOut": () => zoom(-ZOOM_STEP),
    "view.zoomReset": () => webContents()?.setZoomFactor?.(1),
    "view.toggleFullscreen": () => {
      const win = requireWindow();
      win.setFullScreen(!win.isFullScreen());
    },
    // ---- 窗口：关闭必须走 window.close()，触发第 18 条的同一 close handler ----
    "window.minimize": () => requireWindow().minimize(),
    "window.toggleMaximize": () => {
      const win = requireWindow();
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    },
    "window.close": () => requireWindow().close(),
    // ---- 文件 ----
    "file.openDataDir": () => openPath(getDataDir()),
    // ---- 帮助 ----
    "help.openLogDir": () => openPath(getLogDir()),
    "help.checkUpdate": () => runUpdateCheck(),
    // ---- 关于：版本与固定外链（弹窗内容由渲染层排版） ----
    "about.getInfo": () => ({
      version: app.getVersion(),
      platform,
      dataDir: getDataDir(),
      logDir: getLogDir(),
      github: EXTERNAL_URLS.github,
      website: EXTERNAL_URLS.website,
      license: EXTERNAL_URLS.license,
    }),
    "external.github": () => openExternal("github"),
    "external.website": () => openExternal("website"),
    "external.license": () => openExternal("license"),
  };

  /** 执行一个动作：未知 id 也返回 ok:false，而不是抛到 IPC 层。 */
  async function run(action) {
    if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(handlers, action)) {
      return { ok: false, error: `未知菜单动作: ${String(action)}` };
    }
    try {
      const result = await handlers[action]();
      return { ok: true, result };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      logLine(`menu action failed: ${action}: ${message}`);
      return { ok: false, error: message };
    }
  }

  return { run, actions: Object.keys(handlers) };
}

module.exports = {
  EXTERNAL_URLS,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  clampZoom,
  createDesktopMenuActions,
};
