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
  TITLEBAR_THEME,
  isOpaqueColor,
  normalizeTheme,
  titleBarOverlayFor,
  titleBarFallbackCss,
  windowChromeOptions,
  createTitleBarController,
} = require("../lib/titlebar");
const { EXTERNAL_URLS, clampZoom, createDesktopMenuActions } = require("../lib/desktop-menu");
const { CHANNELS, normalizeOverlayPayload } = require("../lib/desktop-shell-ipc");

// ---- lib/titlebar.js --------------------------------------------------------

test("窗口壳：win32/linux 用 hidden + 默认覆盖层配色，mac 用红绿灯位置", () => {
  const win = windowChromeOptions({ platform: "win32" });
  assert.equal(win.titleBarStyle, "hidden");
  assert.deepEqual(win.titleBarOverlay, {
    // 2026-11-20 第 3 条：这是**默认值**（渲染层上报之前的首帧），真源在页面 CSS 的
    // --rf-titlebar-bg / --rf-titlebar-symbol。改色值改 CSS，不必同步这里。
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

test("覆盖层配色：常量只是默认值，渲染层上报的不透明色优先（第 3 条）", () => {
  // 默认值（窗口创建 / 上报值缺失 / 上报值非法时用）。
  assert.equal(titleBarOverlayFor("light").color, "#f5f7fa");
  assert.equal(titleBarOverlayFor("dark").color, "#151b23");
  assert.notEqual(
    titleBarOverlayFor("dark").symbolColor,
    titleBarOverlayFor("light").symbolColor,
    "两套主题的图标色必须不同（否则深色下按钮看不清）",
  );
  // "system" 无法在纯函数里判定，按浅色兜底（初始主题也是浅色，避免启动闪深）。
  assert.equal(normalizeTheme("system"), "light");
  assert.equal(titleBarOverlayFor("system").color, "#f5f7fa");

  // 渲染层上报的值直接生效：把 CSS 改成 #ffe9c7，不碰主进程，覆盖层就该是 #ffe9c7。
  assert.deepEqual(titleBarOverlayFor("light", { color: "#ffe9c7", symbolColor: "#111111" }), {
    color: "#ffe9c7",
    symbolColor: "#111111",
    height: TITLEBAR_HEIGHT,
  });
  // 只报一半时另一半仍用默认值。
  assert.equal(titleBarOverlayFor("light", { color: "#ffe9c7" }).symbolColor, "#3d4a5c");

  // alpha < 255 一律拒绝：真机实测透明会让三颗按钮连同字形一起消失。
  assert.equal(isOpaqueColor("#000000"), true);
  assert.equal(isOpaqueColor("#00000000"), false);
  assert.equal(isOpaqueColor("rgba(0,0,0,0.5)"), false);
  assert.equal(isOpaqueColor("red"), false);
  assert.equal(isOpaqueColor(" #FFFFFF "), true, "允许裁剪首尾空白");
  assert.equal(titleBarOverlayFor("light", { color: "#00000000" }).color, "#f5f7fa");
  assert.equal(titleBarOverlayFor("dark", { color: "rgba(0,0,0,.5)" }).color, "#151b23");
});

test("主题同步：字符串（旧渲染层）与 { theme, color, symbolColor }（第 3 条）都认", () => {
  const calls = [];
  const logs = [];
  const win = {
    isDestroyed: () => false,
    setTitleBarOverlay: (options) => calls.push(options),
  };
  const controller = createTitleBarController({
    getWindow: () => win,
    platform: "win32",
    logLine: (line) => logs.push(line),
  });

  // 旧形态：只报主题名 → 用默认值。
  assert.equal(controller.applyTheme("dark"), true);
  assert.equal(calls[0].color, "#151b23");
  assert.equal(calls[0].symbolColor, "#c9d4e0");

  // 新形态：颜色覆盖默认值。
  assert.equal(controller.applyTheme({ theme: "light", color: "#ffe9c7", symbolColor: "#222222" }), true);
  assert.deepEqual(calls[1], { color: "#ffe9c7", symbolColor: "#222222", height: TITLEBAR_HEIGHT });

  // 非法颜色 → 回落默认值 + 日志（静默回落会让"按钮消失"无从追查）。
  assert.equal(controller.applyTheme({ theme: "dark", color: "#00000000" }), true);
  assert.equal(calls[2].color, "#151b23");
  assert.ok(
    logs.some((line) => line.includes("ignoring invalid color")),
    "非法色必须留痕",
  );

  // 形状异常（null / 数字 / 缺字段）按"未上报"处理，仍能落到默认值且不抛。
  assert.equal(controller.applyTheme(null), true);
  assert.equal(calls[3].color, "#f5f7fa");
  assert.equal(controller.applyTheme({}), true);
  assert.equal(calls[4].color, "#f5f7fa");

  const mac = createTitleBarController({ getWindow: () => win, platform: "darwin" });
  assert.equal(mac.applyTheme("dark"), false, "macOS 没有覆盖层可同步");

  const gone = createTitleBarController({ getWindow: () => null, platform: "win32" });
  assert.equal(gone.applyTheme("dark"), false);
});

test("IPC 载荷收敛：只保留 theme / color / symbolColor，其他形态一律忽略", () => {
  // 旧渲染层的字符串原样保留（主进程 titlebar 那边再判默认值）。
  assert.equal(normalizeOverlayPayload("dark"), "dark");
  assert.deepEqual(
    normalizeOverlayPayload({ theme: "dark", color: "#151b23", symbolColor: "#c9d4e0", evil: "x" }),
    { theme: "dark", color: "#151b23", symbolColor: "#c9d4e0" },
    "未知字段不得穿过 IPC 进入 applyTheme",
  );
  assert.deepEqual(normalizeOverlayPayload({ color: "#ffffff" }), { theme: "", color: "#ffffff" });
  assert.equal(normalizeOverlayPayload(null), null);
  assert.equal(normalizeOverlayPayload(42), null);
  assert.equal(normalizeOverlayPayload(["dark"]), null);
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

// ---- 与前端 CSS 的契约（第 2 / 3 / 4 条） -----------------------------------
//
// 这三条的现象只在桌面壳里出现（`html:has(.app-titlebar…)` 命中、Windows 画覆盖层、
// View Transitions 的揭示窗口），而样式写错时没有任何运行期报错——投影还在、颜色还是
// 常量，只是"看起来有块亮板/按钮闪一下"。所以至少有断言能在规则被删时立刻红。
// 不用 `?raw` 静态导入：vitest 的 `test.css.include` 只放行少数样式表，没被放行的会
// 变成空字符串，断言真空绿（这里踩过一次）。

/** 去掉注释：注释里提到 `box-shadow: none` 不代表规则存在。 */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function readStyle(file) {
  return fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "styles", file), "utf8");
}

test("第 2 条：抽屉投影只在桌面壳里去掉，且与分界线合并在同一个块", () => {
  const css = readStyle("desktop-titlebar.css");
  const body = stripCssComments(css);
  // 选择器必须带 :has(.app-titlebar:not([data-hidden="true"]))：浏览器版没有标题栏，
  // 保留 antd 默认投影；全屏时标题栏还挂载着（只是 display:none），别被误排除。
  // 同一个选择器有多条规则（top / height / 分界线+投影），只挑"带 box-shadow"的那条。
  const blocks = [
    ...body.matchAll(
      /html:has\(\.app-titlebar:not\(\[data-hidden="true"\]\)\)[^{}]*\.ant-drawer-content-wrapper[^{}]*\{([^}]*)\}/g,
    ),
  ].map((match) => match[1]);
  assert.ok(blocks.length > 0, "缺少 .ant-drawer-content-wrapper 相关规则");
  const rule = blocks.find((text) => /box-shadow:\s*none/.test(text));
  assert.ok(rule, "抽屉投影必须去掉（四向都靠这一条 box-shadow: none）");
  assert.match(
    rule,
    /border-top:\s*1px solid var\(--rf-titlebar-border\)/,
    "第 10 条的分界线必须还在同一个块里（不要新起同选择器的规则）",
  );
  assert.match(rule, /box-sizing:\s*border-box/);

  // 否决过的三条路：裁投影会建立新的包含块；抬 z-index 会盖住 y=0 起的固定层。
  assert.doesNotMatch(body, /\.ant-drawer[^{]*\{[^}]*overflow:\s*hidden/);
  assert.doesNotMatch(body, /\.ant-drawer-content-wrapper[^{]*\{[^}]*clip-path/);
  // 前提必须写在源码里：所有 Drawer 都带遮罩，否则去掉投影会让边缘失去分界。
  assert.match(css, /所有 Drawer 都带遮罩/);
});

test("第 3 条：覆盖层颜色以 CSS 为唯一真源（浅深两套都有 --rf-titlebar-symbol）", () => {
  const css = readStyle("desktop-titlebar.css");
  const body = stripCssComments(css);
  for (const token of ["--rf-titlebar-bg", "--rf-titlebar-symbol"]) {
    const count = (body.match(new RegExp(`${token}\\s*:`, "g")) ?? []).length;
    assert.ok(count >= 2, `${token} 必须在 :root 与 [data-theme="dark"] 各定义一次（当前 ${count}）`);
  }
  // tag 与主进程常量必须同值：默认值仍要对得上（否则首帧会闪一下不同的颜色）。
  assert.ok(body.includes(`--rf-titlebar-symbol: ${TITLEBAR_THEME.light.symbolColor}`));
  assert.ok(body.includes(`--rf-titlebar-symbol: ${TITLEBAR_THEME.dark.symbolColor}`));
  assert.ok(body.includes(`--rf-titlebar-bg: ${TITLEBAR_THEME.light.color}`));
  assert.ok(body.includes(`--rf-titlebar-bg: ${TITLEBAR_THEME.dark.color}`));
  // 旧注释（"主进程覆盖层颜色与这里逐值一致"）是双真源时代的说法，别让它回来。
  assert.doesNotMatch(css, /主进程覆盖层颜色与这里的 --rf-titlebar-bg 逐值一致/);
});

test("第 4 条：揭示缓动曲线在 CSS 与 titlebarOverlay 之间互相指认", () => {
  const css = readStyle("theme-transition.css");
  assert.match(css, /rf-theme-reveal[^;]*cubic-bezier\(0\.22, 0\.61, 0\.36, 1\)/);
  assert.match(css, /titlebarOverlay\.ts/, "CSS 侧必须指认 JS 侧的复刻，否则只改一边会静默错位");
  assert.match(css, /REVEAL_BEZIER/);
});
