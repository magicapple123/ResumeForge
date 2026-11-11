// SPDX-License-Identifier: Apache-2.0
"use strict";

// 标题栏菜单的**主进程动作表**（问题清单 §19.3）：编辑 / 视图 / 窗口 / 文件目录类
// 动作走 IPC，渲染层只发动作 id，不认识 Electron API。URL 一律用本文件的固定常量，
// 渲染层不能传任意 URL 给 shell.openExternal（contextIsolation 下的最小暴露面）。
//
// 本轮 #34 在这里补的动作：
//   - view.reload / view.toggleDevTools：自绘菜单替换掉 Electron 默认菜单后，这两个
//     默认菜单项与它们的加速键一起消失，对一个"UI 就是网页"的应用是缺陷而不是锦上添花；
//   - window.toggleAlwaysOnTop：置顶（窗口被别的应用盖住时实时语音面试直接作废），
//     返回值带回**切换后的实态**，渲染层据此显示勾选，不自己做乐观翻转；
//   - help.getDiagnostics：给渲染层的「复制诊断信息」供日志侧内容（见
//     lib/diagnostic-summary.js）。
//
// 不 require("electron")：desktop 的离线用例可以注入假 app / window / shell 断言
// 每个动作真的落在对应 API 上，以及「关闭窗口」走窗口 close handler（第 18 条）。

/** 关于弹窗里的三个外链：固定值，只认这三个 key。 */
const EXTERNAL_URLS = {
  github: "https://github.com/magicapple123/ResumeForge",
  website: "https://magicapple123.github.io/ResumeForge-official/",
  license: "https://github.com/magicapple123/ResumeForge/blob/main/LICENSE",
};

/** 诊断信息里最多带多少条 WARN/ERROR（行数上限与 lib/diagnostic-summary.js 同档）。 */
const DIAGNOSTIC_PROBLEM_LIMIT = 50;

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
 * @param {function(): string[]} [deps.readRecentProblems] 最近的 WARN/ERROR 行（#34D）
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
    readRecentProblems = () => [],
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

  /** 页面不可用时抛错（菜单动作回执是 ok:false，而不是静默没反应）。 */
  function requireWebContents() {
    const wc = webContents();
    if (!wc) throw new Error("页面不可用");
    return wc;
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
    // #34E：reload 重新加载的是**同一个 URL**（path/query/hash 都在 URL 里），路由由
    // Chromium 原样保留；渲染层的 desktopRouteMemory 只是"启动落回首页时恢复"的兜底。
    "view.reload": () => {
      const wc = requireWebContents();
      if (typeof wc.reload !== "function") throw new Error("当前页面不支持重新加载");
      wc.reload();
    },
    "view.toggleDevTools": () => {
      const wc = requireWebContents();
      if (typeof wc.toggleDevTools !== "function") throw new Error("当前页面不支持开发者工具");
      wc.toggleDevTools();
    },
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
    // #34A：置顶。以窗口的 isAlwaysOnTop() 为准（不从渲染层传参），切换后把**实态**
    // 带回渲染层做勾选；渲染层不做乐观翻转，所以勾选态不会和窗口状态相反。
    "window.toggleAlwaysOnTop": () => {
      const win = requireWindow();
      if (typeof win.setAlwaysOnTop !== "function") throw new Error("当前平台不支持窗口置顶");
      const previous = typeof win.isAlwaysOnTop === "function" ? Boolean(win.isAlwaysOnTop()) : false;
      win.setAlwaysOnTop(!previous);
      const next = typeof win.isAlwaysOnTop === "function" ? Boolean(win.isAlwaysOnTop()) : !previous;
      return { alwaysOnTop: next };
    },
    "window.close": () => requireWindow().close(),
    // ---- 文件 ----
    "file.openDataDir": () => openPath(getDataDir()),
    // ---- 帮助 ----
    "help.openLogDir": () => openPath(getLogDir()),
    // #34D：诊断文本的"主进程那一半"——日志里最近的 WARN/ERROR。合成与写剪贴板在
    // 渲染层（它才知道模型配置与开关状态），这里只交数据，不拼文本。
    "help.getDiagnostics": () => {
      let problems = [];
      try {
        const picked = readRecentProblems();
        problems = Array.isArray(picked) ? picked.slice(0, DIAGNOSTIC_PROBLEM_LIMIT) : [];
      } catch (err) {
        // 日志读不到只少一段内容：不能让"复制诊断信息"整个失败。
        logLine(`diagnostics: recent problems unavailable: ${err}`);
      }
      return {
        version: app.getVersion(),
        platform,
        dataDir: getDataDir(),
        logDir: getLogDir(),
        problems,
      };
    },
    // #34H：「检查更新」只由「关于」弹窗触发（主菜单里不再放一份），动作保留。
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
