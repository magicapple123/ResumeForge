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

const { MENU_ICONS, MENU_IDS, buildMenuModel, createTrayManager, trayLabelsFor } = require("../lib/tray-menu");
const {
  ITEM_HEIGHT,
  MENU_BORDER_WIDTH,
  MENU_PADDING_Y,
  MENU_SHADOW_BLEED,
  SEPARATOR_HEIGHT,
  computePlacement,
  estimateMenuContentSize,
  estimateMenuSize,
  toWindowBounds,
} = require("../lib/tray-menu-window");
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

test("托盘菜单模型：纯数据（id / type / label / icon / checked / danger / disabled）", () => {
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

  // 第 1 条（QQ 式图标行）：**每一项**都要有 icon。漏一个就等于那一行的文字被推歪，
  // 而 icon 键必须能在桌面托盘菜单的 ICONS 表里找到（见下面的资源用例）。
  const items = model.filter((item) => item.type === "item");
  assert.deepEqual(items.map((item) => item.icon), [
    "win",
    "folder",
    "file",
    "copy",
    "refresh",
    "box",
    "power",
  ]);
  assert.equal(items.every((item) => typeof item.icon === "string" && item.icon), true);
  // 开关行的图标键固定是 box（HTML 按勾选态映射到 boxOn / boxOff）。
  assert.equal(MENU_ICONS.askOnClose, "box");

  // 没有分发器时四项标 disabled 但仍在模型里（菜单高度不跳），勾选态照样现算。
  const offline = buildMenuModel({ getAsk: () => false, getLocale: () => "en" });
  assert.equal(offline.filter((item) => item.disabled).length, 4);
  assert.equal(offline.find((item) => item.id === MENU_IDS.askOnClose).checked, false);
  assert.equal(offline.filter((item) => item.type === "item").every((item) => item.icon), true);
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

// ---- lib/tray-menu-window.js：内容尺寸 / 窗口尺寸 / 18px 出血 ----------------

/** 与真机一致的那份模型：7 项 + 3 条分隔线。 */
function fullModel() {
  return buildMenuModel({ getAsk: () => true, getLocale: () => "en", runMenuAction: () => {} });
}

test("托盘菜单尺寸：内容 = 项数×行高，窗口 = 内容 + 2×18px 投影出血", () => {
  const model = fullModel();
  const items = model.filter((item) => item.type === "item").length;
  const separators = model.filter((item) => item.type === "separator").length;
  assert.equal(items, 7);
  assert.equal(separators, 3);

  const content = estimateMenuContentSize(model);
  // 「内容尺寸 = 项数 × 行高」＋分隔线与卡片内边距/边框（后两者在真机上由 CSS 给出）。
  assert.equal(
    content.height,
    items * ITEM_HEIGHT + separators * SEPARATOR_HEIGHT + MENU_PADDING_Y * 2 + MENU_BORDER_WIDTH * 2,
  );

  const windowSize = estimateMenuSize(model);
  assert.equal(MENU_SHADOW_BLEED, 18, "出血固定 18px（与 CSS 的 #surface padding 一致）");
  // 「窗口尺寸 = 内容 + 2×18」：阴影画在卡片矩形之外，窗口必须比它大一圈，
  // 否则投影被窗口裁掉（Windows 上 transparent + frameless 没有原生阴影）。
  assert.equal(windowSize.width, content.width + 2 * MENU_SHADOW_BLEED);
  assert.equal(windowSize.height, content.height + 2 * MENU_SHADOW_BLEED);
  // 实测口径（Chromium 里量到的真值）：卡片 271 高 -> 窗口 307。
  assert.equal(content.height, 271);
  assert.equal(windowSize.height, 307);
});

test("托盘菜单定位换算：卡片坐标 -> 窗口 bounds 时 x/y 各减 18、宽高各加 36", () => {
  const content = { width: 200, height: 300 };
  // 少改这一步，菜单会整体向右下偏 18px（或阴影被裁掉）。
  assert.deepEqual(toWindowBounds({ x: 100, y: 200 }, content), {
    x: 100 - MENU_SHADOW_BLEED,
    y: 200 - MENU_SHADOW_BLEED,
    width: content.width + 2 * MENU_SHADOW_BLEED,
    height: content.height + 2 * MENU_SHADOW_BLEED,
  });
  // 负坐标（副屏在主屏左侧）也不能被向上取整吃掉。
  assert.equal(toWindowBounds({ x: -18.4, y: -18.4 }, content).x, -36);
});

test("托盘菜单定位：贴到屏幕右下角时卡片不被那 18px 出血顶离屏幕边", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const content = estimateMenuContentSize(fullModel());
  const trayBounds = { x: 1896, y: 1016, width: 24, height: 24 };
  // 定位用的是**卡片**尺寸：卡片右缘必须落在 workArea 内。
  const placement = computePlacement({ trayBounds, workArea, menuSize: content });
  assert.ok(placement.x + content.width <= workArea.width, "卡片不能被推到屏幕外");
  assert.ok(placement.y >= workArea.y, "卡片不能越过工作区上边界");
  // 窗口比卡片大一圈，所以窗口会略微超出 workArea —— 这是有意的（阴影要地方落）。
  const bounds = toWindowBounds(placement, content);
  assert.equal(bounds.x, placement.x - MENU_SHADOW_BLEED);
  assert.equal(bounds.width, content.width + 2 * MENU_SHADOW_BLEED);
});

// ---- 键盘导航：起点是"没有高亮"（第 1 条要点 7） -----------------------------

/**
 * 从 tray-menu.html 里取出 `move(step)` 的实现，在假 items 上跑一遍。
 * 页面脚本不能 require，所以只能这样把行为钉住（而不是只 grep 源码）。
 */
function loadMove(html) {
  const start = html.indexOf("function move(step)");
  const end = html.indexOf("function activate(index)");
  assert.ok(start > 0 && end > start, "tray-menu.html 里必须有 move(step)");
  const source = html.slice(start, end);
  return (items) => {
    const run = new Function(
      "items",
      `var activeIndex = -1;
       // 真实的 setActive 还会写 .active 类；这里只需要它更新下标（并且必须回写
       // activeIndex —— move() 的下一步是从它算的）。
       var setActive = function (index) { activeIndex = index; };
       ${source}
       return function (step) { move(step); return activeIndex; };`,
    );
    return run(items);
  };
}

test("键盘导航：起点 -1 时 ↓ 得第 0 项、↑ 得最后一项（跳过 disabled）", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "tray-menu.html"), "utf8");
  const makeMove = loadMove(html);
  const items = [
    { disabled: false },
    { disabled: false },
    { disabled: false },
    { disabled: false },
    { disabled: false },
    { disabled: false },
    { disabled: false },
  ];
  assert.equal(makeMove(items)(1), 0, "没有高亮时按 ↓ 落到第一项");
  assert.equal(makeMove(items)(-1), items.length - 1, "没有高亮时按 ↑ 落到最后一项");
  // 中间夹一个 disabled 项：往下要跳过它。
  const withDisabled = items.map((item, index) => (index === 1 ? { disabled: true } : item));
  assert.equal(makeMove(withDisabled)(1), 0);
  // 全禁用时不得死循环 / 不得改动高亮。
  const allDisabled = items.map(() => ({ disabled: true }));
  assert.equal(makeMove(allDisabled)(1), -1);
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

test("托盘菜单视觉契约（第 1 条）：18px 出血、内缩高亮、每项都有图标位、无首项预高亮", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "tray-menu.html"), "utf8");

  // 1) 投影出血：外层 #surface 提供 18px 内边距，窗口比卡片大一圈。
  assert.ok(html.includes('id="surface"'), "需要 #surface 包住卡片（投影要地方落）");
  assert.match(html, /#surface\s*\{[^}]*padding:\s*18px/, "#surface 必须是 18px 内边距");
  assert.equal(
    html.includes("padding: 18px"),
    true,
    "18px 必须与 lib/tray-menu-window.js 的 MENU_SHADOW_BLEED 一致",
  );
  assert.match(html, /#menu\s*\{[^}]*box-shadow:\s*var\(--shadow\)/, "卡片靠投影浮起，不靠描边");
  assert.match(html, /min-width:\s*168px/, "宽度下限抬到 168（图标位占宽）");
  assert.match(html, /padding:\s*6px;/, "卡片内边距 6px（高亮的内缩就来自它）");

  // 2) 行与图标：32px 行高、6px 圆角、9px 间距、16px 图标位。
  assert.match(html, /height:\s*32px/, "行高 32");
  assert.match(html, /border-radius:\s*6px/, "高亮是 6px 圆角条");
  assert.match(html, /gap:\s*9px/, "图标与文字间距 9px");
  assert.match(html, /\.item \.ic\s*\{[^}]*width:\s*16px/, "固定 16px 图标位");
  // 高亮只有一个来源（.active），不能再写 :hover —— 否则键盘与鼠标会同时高亮两行。
  assert.equal(/\.item:hover/.test(html), false, "不要额外加 :hover 高亮");
  assert.match(html, /\.item\.active\s*\{[^}]*background:\s*var\(--hover\)/, "高亮来自 .active");

  // 3) 每项都有图标：模型里的 icon 键必须能在 ICONS 表里找到（box 走 boxOn/boxOff）。
  const iconKeys = [...html.matchAll(/(\w+):\s*'<svg/g)].map((match) => match[1]);
  for (const key of ["win", "folder", "file", "copy", "refresh", "power", "boxOn", "boxOff"]) {
    assert.ok(iconKeys.includes(key), `ICONS 表缺 ${key}`);
  }
  for (const icon of Object.values(MENU_ICONS)) {
    const resolved = icon === "box" ? ["boxOn", "boxOff"] : [icon];
    for (const name of resolved) {
      assert.ok(iconKeys.includes(name), `模型里的 icon "${icon}" 在 ICONS 表里找不到`);
    }
  }
  // 取不到图标也要留空占位（否则那一行文字被 gap 推歪）。
  assert.match(html, /span\.className = "ic"/, "iconNode 必须先建出占位再尝试插 SVG");
  assert.match(html, /if \(svg\) span\.innerHTML = svg/, "没有图标时留空占位，不跳过渲染");

  // 4) 首项不再预高亮：activeIndex 从 -1 开始。
  assert.match(html, /var activeIndex = -1;/, "activeIndex 必须是 -1（无首项高亮）");
  assert.equal(/setActive\(0\)/.test(html), false, "不能再有首项预高亮");

  // 5) 点击命中图标时事件目标是 SVG 元素，它的 className 不是字符串 ——
  //    旧写法 `target.className.indexOf("item")` 会抛 TypeError（点击静默失效）。
  assert.match(html, /function itemNodeFrom\(event\)/, "要用 classList 判菜单项");
  assert.equal(
    /event\.target\.className\.indexOf/.test(html),
    false,
    "不能用 className.indexOf 判项（SVG 元素会抛）",
  );
});
