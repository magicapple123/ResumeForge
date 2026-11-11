// SPDX-License-Identifier: Apache-2.0
/**
 * 自绘标题栏（问题清单 §19）的离线用例：
 *  - lib/titlebar.js：窗口壳选项、覆盖层配色、主题同步、窗口状态推送；
 *  - lib/desktop-menu.js：菜单动作真的落在对应 Electron API 上，且只认固定动作 id；
 *  - lib/tray-menu.js：「关闭窗口时询问」勾选态来自记忆，勾上即清掉记忆；
 *  - preload.js 的 desktopShell 桥：通道名必须与 desktop-shell-ipc.js 逐字一致。
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
  windowChromeOptions,
  createTitleBarController,
} = require("../lib/titlebar");
const { EXTERNAL_URLS, clampZoom, createDesktopMenuActions } = require("../lib/desktop-menu");
const { TRAY_LABELS, buildTrayTemplate, createTrayManager } = require("../lib/tray-menu");
const { CHANNELS } = require("../lib/desktop-shell-ipc");

// ---- lib/titlebar.js --------------------------------------------------------

test("窗口壳：win32/linux 用 hidden + titleBarOverlay，mac 用红绿灯位置", () => {
  const win = windowChromeOptions({ platform: "win32" });
  assert.equal(win.titleBarStyle, "hidden");
  assert.deepEqual(win.titleBarOverlay, {
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

test("覆盖层配色与标题栏背景逐值一致，深色主题另有一套", () => {
  assert.equal(typeof titleBarOverlayFor("light").color, "string");
  assert.equal(titleBarOverlayFor("light").color, "#f5f7fa");
  const dark = titleBarOverlayFor("dark");
  assert.equal(dark.color, "#151b23");
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

// ---- lib/tray-menu.js -------------------------------------------------------

function makeTrayTemplateHarness(remembered = null) {
  const calls = { cleared: 0, refreshed: 0, quits: 0, shows: 0 };
  const win = {
    show() {
      calls.shows += 1;
    },
    focus() {},
  };
  const template = buildTrayTemplate({
    getWindow: () => win,
    app: {
      quit() {
        calls.quits += 1;
      },
    },
    getRemembered: () => remembered,
    clearRemembered: () => {
      calls.cleared += 1;
      remembered = null;
    },
    refresh: () => {
      calls.refreshed += 1;
    },
  });
  return { template, calls, getRemembered: () => remembered };
}

test("托盘菜单：打开 / 关闭窗口时询问（checkbox）/ 退出，勾选态取自记忆", () => {
  const noMemory = makeTrayTemplateHarness(null);
  const labels = noMemory.template.filter((item) => item.type !== "separator").map((item) => item.label);
  assert.deepEqual(labels, [TRAY_LABELS.open, TRAY_LABELS.askOnClose, TRAY_LABELS.quit]);
  const ask = noMemory.template.find((item) => item.label === TRAY_LABELS.askOnClose);
  assert.equal(ask.type, "checkbox");
  assert.equal(ask.checked, true, "没有记忆时勾上 = 每次询问");

  const remembered = makeTrayTemplateHarness("minimize");
  const askRemembered = remembered.template.find((item) => item.label === TRAY_LABELS.askOnClose);
  assert.equal(askRemembered.checked, false, "已记住时取消勾选");

  // 勾上 → 清掉记忆（main.js 的 onPreferenceChanged 会重建菜单，这里不重复刷）。
  askRemembered.click({ checked: true });
  assert.equal(remembered.calls.cleared, 1);
  assert.equal(remembered.calls.refreshed, 0);
  assert.equal(remembered.getRemembered(), null);
  // 取消勾选没有语义：重建菜单让勾选态回到真相。
  askRemembered.click({ checked: false });
  assert.equal(remembered.calls.refreshed, 1);

  // 托盘「退出」永远是真退出，不读记忆、不弹窗（app.quit() 交给 before-quit）。
  const exitItem = noMemory.template.find((item) => item.label === TRAY_LABELS.quit);
  exitItem.click();
  assert.equal(noMemory.calls.quits, 1);
});

test("托盘生命周期：create 装菜单与左键唤起；refresh 重建；destroy 可重复", () => {
  const contexts = [];
  class TrayFake {
    constructor(icon) {
      this.icon = icon;
      this.handlers = {};
      TrayFake.instance = this;
    }
    setToolTip() {}
    setContextMenu(menu) {
      contexts.push(menu);
    }
    on(name, handler) {
      this.handlers[name] = handler;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  let remembered = null;
  let shows = 0;
  const manager = createTrayManager({
    Tray: TrayFake,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    iconPath: "icon.png",
    app: { quit() {} },
    getWindow: () => ({
      show() {
        shows += 1;
      },
      focus() {},
    }),
    getRemembered: () => remembered,
    clearRemembered: () => {
      remembered = null;
    },
  });
  manager.create();
  assert.equal(TrayFake.instance.icon, "icon.png");
  assert.equal(contexts.length, 1);
  TrayFake.instance.handlers.click();
  assert.equal(shows, 1);

  remembered = "quit";
  manager.refresh();
  assert.equal(contexts.length, 2);
  const ask = contexts[1].template.find((item) => item.label === TRAY_LABELS.askOnClose);
  assert.equal(ask.checked, false);

  manager.destroy();
  assert.equal(manager.getTray(), null);
  manager.destroy(); // 重复销毁不抛
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

  // 调用一下，断言发送到的通道名与 desktop-shell-ipc.js 的定义一致。
  shell.menuAction("edit.undo").then((payload) => {
    assert.equal(payload.channel, CHANNELS.menuAction);
    assert.equal(payload.payload.action, "edit.undo");
  });
  shell.getWindowState();
  shell.setTheme("dark");
  shell.setEditableFocus(true);
  shell.onWindowState(() => {});
  const sentChannels = listeners.map((entry) => entry.channel);
  assert.ok(sentChannels.includes(CHANNELS.menuAction));
  assert.ok(sentChannels.includes(CHANNELS.getWindowState));
  assert.ok(sentChannels.includes(CHANNELS.setTheme));
  assert.ok(sentChannels.includes(CHANNELS.windowState));
  assert.ok(sentChannels.includes(CHANNELS.editableFocus));
  // 只发布尔：即使传字符串也不会把任意载荷送进主进程。
  assert.equal(
    listeners.find((entry) => entry.channel === CHANNELS.editableFocus).payload,
    true,
  );
});
