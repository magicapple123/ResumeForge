// SPDX-License-Identifier: Apache-2.0
/**
 * 托盘与自绘右键菜单的离线用例（2026-11-20）：
 *  - lib/tray-menu.js：纯数据模型 + 管理器（「关闭窗口时询问」是真开关）；
 *  - lib/tray-menu-window.js：定位纯函数（贴边翻转 + clamp），可离线单测；
 *  - lib/window-shell.js：托盘动作分发（dispatcher 不可用时必须留日志）；
 *  - tray-menu.html / tray-menu-preload.js：与 main.js 同层、CSP 与无障碍属性。
 *
 * 原属 test-desktop-shell.js，拆出来是因为两个文件都受 500 行预算约束。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { MENU_IDS, buildMenuModel, createTrayManager, trayLabelsFor } = require("../lib/tray-menu");
const { computePlacement } = require("../lib/tray-menu-window");
const { createWindowShell } = require("../lib/window-shell");
const { registerDesktopShellIpc } = require("../lib/desktop-shell-ipc");

// ---- lib/tray-menu.js（自绘菜单的纯数据模型 + 管理器） -----------------------

function trayManagerHarness() {
  const calls = { shows: 0, quits: 0, runs: [], asks: [], menus: [], log: [] };
  let ask = true;
  class TrayFake {
    constructor(icon) {
      this.icon = icon;
      this.handlers = {};
      TrayFake.instance = this;
    }
    setToolTip(tooltip) {
      this.toolTip = tooltip;
    }
    on(name, handler) {
      this.handlers[name] = handler;
    }
    getBounds() {
      return { x: 1800, y: 1000, width: 24, height: 24 };
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const manager = createTrayManager({
    Tray: TrayFake,
    iconPath: "tray.ico",
    app: { quit: () => { calls.quits += 1; } },
    getWindow: () => ({ show: () => { calls.shows += 1; }, focus() {} }),
    getAsk: () => ask,
    setAsk: (value) => {
      ask = value;
      calls.asks.push(value);
      return true;
    },
    runMenuAction: (id) => calls.runs.push(id),
    openMenu: (input) => calls.menus.push(input),
    getLocale: () => "en",
    logLine: (line) => calls.log.push(line),
  });
  return { manager, calls, TrayFake, getAsk: () => ask };
}

test("托盘菜单模型：纯数据（id / type / label / checked / danger / disabled）", () => {
  const labels = trayLabelsFor("en");
  const model = buildMenuModel({ getAsk: () => true, getLocale: () => "en", runMenuAction: () => {} });
  assert.deepEqual(
    model.filter((item) => item.type === "item").map((item) => item.label),
    [
      labels.open,
      labels.openDataDir,
      labels.openLogDir,
      labels.diagnostics,
      labels.checkUpdate,
      labels.askOnClose,
      labels.quit,
    ],
  );
  assert.equal(model.find((item) => item.id === MENU_IDS.askOnClose).checked, true);
  assert.equal(model.find((item) => item.id === MENU_IDS.quit).danger, true);
  // 每个分隔线也有唯一 id：HTML 用它认项，重复 id 会让 aria-activedescendant 指错。
  const ids = model.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);

  // 没有分发器时四项标 disabled 但仍在模型里（菜单高度不跳），勾选态照样现算。
  const offline = buildMenuModel({ getAsk: () => false, getLocale: () => "en" });
  assert.equal(offline.filter((item) => item.disabled).length, 4);
  assert.equal(offline.find((item) => item.id === MENU_IDS.askOnClose).checked, false);
  // 不再产出原生 Menu 模板对象（没有 click / type:"checkbox" 这些字段）。
  assert.equal(model.some((item) => typeof item.click === "function"), false);
  assert.equal(model.some((item) => item.type === "checkbox"), false);
});

test("托盘管理器：左键唤起、右键出自绘菜单、勾选项在主进程翻转", () => {
  const { manager, calls, TrayFake, getAsk } = trayManagerHarness();
  manager.create();
  assert.equal(TrayFake.instance.icon, "tray.ico", "固定用传进来的那一枚图标（不再按主题换图）");
  TrayFake.instance.handlers.click();
  assert.equal(calls.shows, 1, "左键仍唤起窗口");

  TrayFake.instance.handlers["right-click"]();
  assert.equal(calls.menus.length, 1, "右键走自绘菜单，不再 tray.setContextMenu");
  assert.equal(calls.menus[0].anchor.width, 24, "定位要用托盘的实时 bounds");
  assert.ok(Array.isArray(calls.menus[0].model));

  // 取消勾选 → 真写 false；再点一下 → 又变 true（不再是"勾不掉"的镜像）。
  manager.choose(MENU_IDS.askOnClose);
  assert.equal(getAsk(), false);
  assert.deepEqual(calls.asks, [false]);
  assert.equal(manager.getMenuModel().find((item) => item.id === MENU_IDS.askOnClose).checked, false);
  manager.choose(MENU_IDS.askOnClose);
  assert.equal(getAsk(), true);

  manager.choose("file.openDataDir");
  manager.choose("help.checkUpdate");
  assert.deepEqual(calls.runs, ["file.openDataDir", "help.checkUpdate"]);
  assert.equal(calls.shows, 2, "检查更新要先唤起主窗口");
  manager.choose("nope.action");
  assert.ok(calls.log.some((line) => /unknown menu id: nope\.action/.test(line)));

  manager.choose(MENU_IDS.quit);
  assert.equal(calls.quits, 1, "退出永远走 app.quit()（before-quit 才是唯一停止点）");

  manager.destroy();
  assert.equal(manager.getTray(), null);
  manager.destroy(); // 重复销毁不抛
});

// ---- lib/tray-menu-window.js（定位纯函数） ----------------------------------

test("托盘菜单定位：贴图标上方居中，任务栏在上下左右都能翻转且不飞出 workArea", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const menuSize = { width: 200, height: 260 };

  // 任务栏在底部（常态）：图标上方、水平居中。
  assert.deepEqual(
    computePlacement({ trayBounds: { x: 1800, y: 1016, width: 24, height: 24 }, workArea, menuSize }),
    { x: 1712, y: 752 },
  );
  // 任务栏在顶部：上方放不下 → 翻到图标下方。
  assert.deepEqual(
    computePlacement({ trayBounds: { x: 900, y: 0, width: 24, height: 24 }, workArea, menuSize }),
    { x: 812, y: 28 },
  );
  // 任务栏在左：居中会越出左边界 → 翻到图标右侧。
  assert.deepEqual(
    computePlacement({ trayBounds: { x: 0, y: 500, width: 24, height: 24 }, workArea, menuSize }),
    { x: 28, y: 236 },
  );
  // 任务栏在右：翻到图标左侧。
  assert.deepEqual(
    computePlacement({ trayBounds: { x: 1896, y: 500, width: 24, height: 24 }, workArea, menuSize }),
    { x: 1692, y: 236 },
  );
  // 小屏兜底：怎么翻都放不下时 clamp 在 workArea 内（不出现负数坐标）。
  assert.deepEqual(
    computePlacement({
      trayBounds: { x: 150, y: 220, width: 24, height: 24 },
      workArea: { x: 0, y: 0, width: 320, height: 240 },
      menuSize: { width: 280, height: 260 },
    }),
    { x: 22, y: 0 },
  );
});

// ---- lib/window-shell.js：托盘动作分发（条目 2 的事故点） ---------------------

function windowShellHarness(menuShell, log = []) {
  const store = {
    readState: () => ({ ask: true, action: null }),
    writeAsk: () => true,
    rememberAction: () => true,
    getAsk: () => true,
    getAction: () => null,
  };
  const TrayFake = class {
    constructor(icon) {
      this.icon = icon;
      this.handlers = {};
    }
    on(name, handler) {
      this.handlers[name] = handler;
    }
    setToolTip() {}
    getBounds() {
      return { x: 0, y: 0, width: 16, height: 16 };
    }
    destroy() {}
  };
  const shell = createWindowShell({
    app: { isPackaged: false, quit() {} },
    Tray: TrayFake,
    BrowserWindow: class {},
    ipcMain: { on() {} },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
    dirname: "D:/apps/desktop",
    clipboard: { writeText() {} },
    promptClose: () => Promise.resolve({ action: "hide", remember: false }),
    getWindow: () => null,
    isQuitting: () => false,
    setQuitting: () => {},
    store,
    getMenu: () => menuShell,
    getLocale: () => "en",
    logLine: (line) => log.push(line),
  });
  shell.trayManager.create();
  return { shell, log };
}

test("托盘动作分发：{menu:{run}} 可执行；只有 {menu:{}} 时留日志且不抛", () => {
  const runCalls = [];
  const healthy = windowShellHarness({
    menu: {
      run: (id) => {
        runCalls.push(id);
        return Promise.resolve({ ok: true });
      },
    },
  });
  healthy.shell.trayManager.choose("file.openDataDir");
  assert.deepEqual(runCalls, ["file.openDataDir"], "返回壳里有 menu.run 时必须真的执行");

  const log = [];
  const broken = windowShellHarness({ menu: {} }, log);
  // 2026-11-20 事故：main.js 曾把 `{ menu, channels }` 整个壳当成分发器，`.run`
  // 永远是 undefined，四个动作在这一行被静默吞掉。现在必须留下可观测的日志。
  assert.doesNotThrow(() => broken.shell.trayManager.choose("help.openLogDir"));
  assert.ok(
    log.some((line) => line.includes("dispatcher unavailable: help.openLogDir")),
    "dispatcher 不可用时必须留日志（失灵要可观测）",
  );
});

test("registerDesktopShellIpc 的返回形状必须有 .menu.run（托盘依赖它）", () => {
  const handlers = {};
  const shell = registerDesktopShellIpc({
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; }, on: (name, fn) => { handlers[name] = fn; } },
    app: { getPath: () => "D:/tmp", getVersion: () => "2.0.0" },
    getWindow: () => null,
    shell: { openPath: () => Promise.resolve(""), openExternal: () => Promise.resolve() },
    getDataDir: () => "D:/data",
    getLogDir: () => "D:/logs",
    runUpdateCheck: () => {},
    titleBar: { windowState: () => ({ maximized: false, fullscreen: false }), applyTheme: () => false },
    logLine: () => {},
  });
  assert.equal(typeof shell.menu.run, "function", "返回壳上必须有 .menu.run");
  assert.ok(shell.channels, "channels 仍在返回壳上（preload 桥用）");
});

// ---- 资源与安全（asar 根 / CSP / 无障碍） ------------------------------------

test("托盘菜单资源与 main.js 同层：CSP、role、aria-checked、preload 三个方法", () => {
  const desktopDir = path.join(__dirname, "..");
  const htmlPath = path.join(desktopDir, "tray-menu.html");
  const preloadPath = path.join(desktopDir, "tray-menu-preload.js");
  assert.ok(fs.existsSync(htmlPath), "tray-menu.html 必须在 asar 根（与 main.js 同层）");
  assert.ok(fs.existsSync(preloadPath), "tray-menu-preload.js 同上");

  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(
    html.includes("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"),
    "CSP 必须照抄 close-dialog.html",
  );
  assert.ok(html.includes('role="menu"'), "容器要有 role=menu");
  // 菜单项与分隔线是 JS 建节点时设的 role，所以查字面量而不是属性写法。
  assert.ok(html.includes('"menuitem"'), "每一项要有 role=menuitem");
  assert.ok(html.includes('"separator"'), "分隔线要有 role=separator");
  assert.ok(html.includes("aria-checked"), "勾选项要报 aria-checked");

  const preload = fs.readFileSync(preloadPath, "utf8");
  for (const name of ["onModel", "choose", "close"]) {
    assert.ok(preload.includes(name), `preload 必须暴露 ${name}`);
  }

  // 真机事故教训（close-dialog 曾多写一个 .. 导致 ERR_FILE_NOT_FOUND）：
  // dirname 已经是包含 main.js 的那一层，不能再往上拼。
  const code = fs
    .readFileSync(path.join(desktopDir, "lib", "tray-menu-window.js"), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
  assert.ok(!code.includes('"..", "tray-menu'), "别再用 .. 往上拼");
  assert.ok(code.includes('path.join(dirname, "tray-menu.html")'), "html 就在 dirname 这一层");
});
