// SPDX-License-Identifier: Apache-2.0
/**
 * 自绘标题栏（问题清单 §19）的离线用例：
 *  - lib/titlebar.js：窗口壳选项、覆盖层配色、主题同步、窗口状态推送；
 *  - lib/desktop-menu.js：菜单动作真的落在对应 Electron API 上，且只认固定动作 id；
 *  - preload.js 的 desktopShell 桥：通道名必须与 desktop-shell-ipc.js 逐字一致。
 *
 * 托盘与自绘菜单（模型 / 定位 / 动作分发）的用例在 test-tray-menu.js（500 行预算）。
 *
 * 这些模块都不 require("electron")，所以这里全部用假对象断言，不需要真窗口。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const {
  TITLEBAR_HEIGHT,
  normalizeTheme,
  titleBarOverlayFor,
  titleBarFallbackCss,
  windowChromeOptions,
  createTitleBarController,
} = require("../lib/titlebar");
const { EXTERNAL_URLS, clampZoom, createDesktopMenuActions } = require("../lib/desktop-menu");
const { CHANNELS } = require("../lib/desktop-shell-ipc");

// ---- lib/titlebar.js --------------------------------------------------------

test("窗口壳：win32/linux 用 hidden + 透明覆盖层，mac 用红绿灯位置", () => {
  const win = windowChromeOptions({ platform: "win32" });
  assert.equal(win.titleBarStyle, "hidden");
  assert.deepEqual(win.titleBarOverlay, {
    // 2026-11-20：覆盖层不画底色（透明），底色交给页面标题栏。
    color: "#f5f7fa",
    symbolColor: "#3d4a5c",
    height: TITLEBAR_HEIGHT,
  });
  assert.equal(TITLEBAR_HEIGHT, 32, "自绘标题栏高度固定 32px（净增 0px 的前提）");

  const linux = windowChromeOptions({ platform: "linux" });
  assert.equal(linux.titleBarOverlay.height, 32);

  const mac = windowChromeOptions({ platform: "darwin" });
  assert.equal(mac.titleBarStyle, "hidden");
  assert.equal(mac.titleBarOverlay, undefined, "macOS 不支持 titleBarOverlay");
  assert.deepEqual(mac.trafficLightPosition, { x: 12, y: 10 });
});

test("关闭卡片资源与 main.js 同层，路径里不能多一个 ..", () => {
  // 真机事故 2026-11-20：close-dialog.js 用 path.join(dirname, "..", "close-dialog.html")，
  // 而 dirname 是 main.js 所在的层（打包态 = app.asar 根），于是解析到 resources/ 下、
  // loadURL 永远 ERR_FILE_NOT_FOUND，catch 回落"最小化到托盘" —— 用户看到"点 × 没反应"。
  const desktopDir = path.join(__dirname, "..");
  assert.ok(fs.existsSync(path.join(desktopDir, "close-dialog.html")), "卡片就在这一层");
  assert.ok(fs.existsSync(path.join(desktopDir, "close-dialog-preload.js")), "preload 也在这一层");
  const code = fs
    .readFileSync(path.join(desktopDir, "lib", "close-dialog.js"), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*)/.test(line)) // 注释里描述旧写法，不算违规
    .join("\n");
  assert.ok(
    !code.includes('"..", "close-dialog'),
    "别再用 .. 往上拼：dirname 已经是包含这些资源的那一层",
  );
});

test("标题栏兜底 padding 必须条件化，否则与 flex 标题栏叠加（真机事故 2026-11-20）", () => {
  const css = titleBarFallbackCss();
  assert.ok(
    css.startsWith("html:not(:has(.app-titlebar))"),
    "兜底只在标题栏缺席时生效：did-finish-load 早于 React 挂载，此时 .app-titlebar 必然还没有，" +
      "无条件注入会让 body padding 与 .app-titlebar（纵向 flex 第一项）叠加，整页被顶下 32px、" +
      "系统三颗按钮浮在自绘标题栏上方",
  );
  assert.ok(css.includes(`padding-top:${TITLEBAR_HEIGHT}px`), "高度仍从 TITLEBAR_HEIGHT 取，不写字面量");
  assert.equal(titleBarFallbackCss(40), "html:not(:has(.app-titlebar)) body{padding-top:40px}");
});

test("覆盖层不画底色（两套主题都是全透明），symbolColor 仍按主题区分", () => {
  assert.equal(typeof titleBarOverlayFor("light").color, "string");
  assert.equal(titleBarOverlayFor("light").color, "#f5f7fa");
  const dark = titleBarOverlayFor("dark");
  assert.equal(dark.color, "#151b23", "深色主题用深色覆盖层底色");
  assert.notEqual(dark.symbolColor, titleBarOverlayFor("light").symbolColor);
  // "system" 无法在纯函数里判定，按浅色兜底（初始主题也是浅色，避免启动闪深）。
  assert.equal(normalizeTheme("system"), "light");
  assert.equal(titleBarOverlayFor("system").color, "#f5f7fa");
});

test("主题同步：调用 setTitleBarOverlay；窗口不可用 / 平台不支持时静默返回 false", () => {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    setTitleBarOverlay: (options) => calls.push(options),
  };
  const controller = createTitleBarController({ getWindow: () => win, platform: "win32" });
  assert.equal(controller.applyTheme("dark"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].color, "#151b23");
  assert.equal(calls[0].symbolColor, "#c9d4e0");

  const mac = createTitleBarController({ getWindow: () => win, platform: "darwin" });
  assert.equal(mac.applyTheme("dark"), false, "macOS 没有覆盖层可同步");

  const gone = createTitleBarController({ getWindow: () => null, platform: "win32" });
  assert.equal(gone.applyTheme("dark"), false);
});

test("窗口状态：快照 + 推送给渲染层（菜单文案与全屏隐藏标题栏用）", () => {
  const sent = [];
  const win = {
    isDestroyed: () => false,
    isMaximized: () => true,
    isFullScreen: () => false,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
  };
  const controller = createTitleBarController({ getWindow: () => win, platform: "win32" });
  assert.deepEqual(controller.windowState(), { maximized: true, fullscreen: false });
  controller.sendWindowState();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, CHANNELS.windowState);
  assert.deepEqual(sent[0].payload, { maximized: true, fullscreen: false });

  const missing = createTitleBarController({ getWindow: () => null, platform: "win32" });
  assert.deepEqual(missing.windowState(), { maximized: false, fullscreen: false });
  missing.sendWindowState(); // 不抛
});

// ---- lib/desktop-menu.js ----------------------------------------------------

function makeMenuHarness() {
  const calls = { window: [], web: [], shell: [], updates: 0, log: [] };
  const webContents = {
    undo: () => calls.web.push("undo"),
    redo: () => calls.web.push("redo"),
    cut: () => calls.web.push("cut"),
    copy: () => calls.web.push("copy"),
    paste: () => calls.web.push("paste"),
    selectAll: () => calls.web.push("selectAll"),
    zoomFactor: 1,
    getZoomFactor() {
      return this.zoomFactor;
    },
    setZoomFactor(value) {
      this.zoomFactor = value;
      calls.web.push(["zoom", value]);
    },
  };
  const win = {
    webContents,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    minimized: 0,
    maximized: false,
    fullScreen: false,
    minimize() {
      this.minimized += 1;
    },
    maximize() {
      this.maximized = true;
    },
    unmaximize() {
      this.maximized = false;
    },
    isMaximized() {
      return this.maximized;
    },
    setFullScreen(value) {
      this.fullScreen = Boolean(value);
    },
    isFullScreen() {
      return this.fullScreen;
    },
    close() {
      calls.window.push("close");
    },
    destroy() {
      calls.window.push("destroy");
    },
  };
  const menu = createDesktopMenuActions({
    app: { getVersion: () => "2.0.0" },
    getWindow: () => win,
    shell: {
      openPath: (target) => {
        calls.shell.push(["openPath", target]);
        return Promise.resolve("");
      },
      openExternal: (url) => {
        calls.shell.push(["openExternal", url]);
        return Promise.resolve();
      },
    },
    getDataDir: () => "D:/data",
    getLogDir: () => "D:/logs",
    runUpdateCheck: () => {
      calls.updates += 1;
    },
    platform: "win32",
    logLine: (line) => calls.log.push(line),
  });
  return { menu, win, webContents, calls };
}

test("编辑 / 视图 / 窗口动作落在 webContents 与 window 上（不是 no-op）", async () => {
  const { menu, win, calls } = makeMenuHarness();
  for (const action of ["edit.undo", "edit.redo", "edit.cut", "edit.copy", "edit.paste", "edit.selectAll"]) {
    assert.equal((await menu.run(action)).ok, true, action);
  }
  assert.deepEqual(calls.web, ["undo", "redo", "cut", "copy", "paste", "selectAll"]);

  await menu.run("view.zoomIn");
  assert.equal(win.webContents.zoomFactor, 1.1);
  await menu.run("view.zoomOut");
  await menu.run("view.zoomOut");
  assert.equal(win.webContents.zoomFactor, 0.9);
  await menu.run("view.zoomReset");
  assert.equal(win.webContents.zoomFactor, 1);
  // 缩放夹在 lib/window-state.js 的验收区间 [0.8, 1.5]。
  assert.equal(clampZoom(9), 1.5);
  assert.equal(clampZoom(0.1), 0.8);

  await menu.run("view.toggleFullscreen");
  assert.equal(win.fullScreen, true);
  await menu.run("view.toggleFullscreen");
  assert.equal(win.fullScreen, false);

  await menu.run("window.minimize");
  assert.equal(win.minimized, 1);
  await menu.run("window.toggleMaximize");
  assert.equal(win.maximized, true);
  await menu.run("window.toggleMaximize");
  assert.equal(win.maximized, false);
  // 「关闭窗口」必须走 window.close()（触发第 18 条 close handler），不能 destroy()。
  await menu.run("window.close");
  assert.deepEqual(calls.window, ["close"]);
});

test("文件 / 帮助 / 关于 / 外链：目录与 URL 都是固定值", async () => {
  const { menu, calls } = makeMenuHarness();
  await menu.run("file.openDataDir");
  await menu.run("help.openLogDir");
  assert.deepEqual(calls.shell, [
    ["openPath", "D:/data"],
    ["openPath", "D:/logs"],
  ]);
  await menu.run("help.checkUpdate");
  assert.equal(calls.updates, 1);

  const info = await menu.run("about.getInfo");
  assert.equal(info.ok, true);
  assert.equal(info.result.version, "2.0.0");
  assert.equal(info.result.github, EXTERNAL_URLS.github);
  assert.equal(info.result.platform, "win32");

  await menu.run("external.website");
  assert.deepEqual(calls.shell.slice(-1), [["openExternal", EXTERNAL_URLS.website]]);
  // 固定三个外链，渲染层不能传任意 URL。
  assert.deepEqual(Object.keys(EXTERNAL_URLS).sort(), ["github", "license", "website"]);
});

test("未知动作 / 主窗口缺失 / openPath 返回错误字符串：都返回 ok:false，不抛", async () => {
  const { menu, win, calls } = makeMenuHarness();
  assert.equal((await menu.run("window.destroyEverything")).ok, false);
  assert.equal((await menu.run(42)).ok, false);

  const noWindow = createDesktopMenuActions({
    app: { getVersion: () => "2.0.0" },
    getWindow: () => null,
    shell: { openPath: () => Promise.resolve(""), openExternal: () => Promise.resolve() },
    getDataDir: () => "D:/data",
    getLogDir: () => null,
    runUpdateCheck: () => {},
    platform: "win32",
  });
  assert.equal((await noWindow.run("window.close")).ok, false);
  assert.equal((await noWindow.run("help.openLogDir")).ok, false, "日志目录不可用时不会拿 null 去 openPath");

  const failing = createDesktopMenuActions({
    app: { getVersion: () => "2.0.0" },
    getWindow: () => win,
    shell: { openPath: () => Promise.resolve("EPERM: denied"), openExternal: () => Promise.resolve() },
    getDataDir: () => "D:/data",
    getLogDir: () => "D:/logs",
    runUpdateCheck: () => {},
    platform: "win32",
    logLine: (line) => calls.log.push(line),
  });
  const outcome = await failing.run("file.openDataDir");
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /EPERM/);
});

// ---- preload 桥 -------------------------------------------------------------

test("preload 暴露 desktopShell 桥，通道名与主进程逐字一致", () => {
  const exposed = {};
  const listeners = [];
  const source = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  vm.runInNewContext(source, {
    require(spec) {
      assert.equal(spec, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            exposed[name] = api;
          },
        },
        ipcRenderer: {
          on(channel, handler) {
            listeners.push({ channel, handler });
          },
          send(channel, payload) {
            listeners.push({ channel, payload });
          },
          invoke: (channel, payload) => {
            listeners.push({ channel, payload });
            return Promise.resolve({ channel, payload });
          },
        },
      };
    },
    process: { platform: "win32" },
  });

  assert.equal(exposed.splash.isDesktop, true);
  const shell = exposed.desktopShell;
  assert.ok(shell, "window.desktopShell 必须暴露");
  assert.equal(shell.platform, "win32");
  assert.equal(typeof shell.menuAction, "function");
  assert.equal(typeof shell.getWindowState, "function");
  assert.equal(typeof shell.onWindowState, "function");
  assert.equal(typeof shell.setTheme, "function");
  // #34F：焦点可编辑状态只报一个布尔，主进程侧据它回填窗口实态快照。
  assert.equal(typeof shell.setEditableFocus, "function");
  // T5：应用内语言推送（固定通道，主进程只接受 zh / en）。
  assert.equal(typeof shell.setLocale, "function");

  // 调用一下，断言发送到的通道名与 desktop-shell-ipc.js 的定义一致。
  shell.menuAction("edit.undo").then((payload) => {
    assert.equal(payload.channel, CHANNELS.menuAction);
    assert.equal(payload.payload.action, "edit.undo");
  });
  shell.getWindowState();
  shell.setTheme("dark");
  shell.setEditableFocus(true);
  shell.setLocale("en");
  shell.onWindowState(() => {});
  const sentChannels = listeners.map((entry) => entry.channel);
  assert.ok(sentChannels.includes(CHANNELS.menuAction));
  assert.ok(sentChannels.includes(CHANNELS.getWindowState));
  assert.ok(sentChannels.includes(CHANNELS.setTheme));
  assert.ok(sentChannels.includes(CHANNELS.windowState));
  assert.ok(sentChannels.includes(CHANNELS.editableFocus));
  assert.ok(sentChannels.includes(CHANNELS.setLocale));
  // 只发布尔：即使传字符串也不会把任意载荷送进主进程。
  assert.equal(
    listeners.find((entry) => entry.channel === CHANNELS.editableFocus).payload,
    true,
  );
});
