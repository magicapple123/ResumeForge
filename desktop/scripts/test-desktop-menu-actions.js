// SPDX-License-Identifier: Apache-2.0
/**
 * #34 补进动作表的三组动作（lib/desktop-menu.js）：
 *  - 34E view.reload / view.toggleDevTools：自绘菜单替换默认菜单后，这两个动作随默认
 *    菜单一起消失过——它们必须真的落在 webContents 上，且 reload 不改 URL（路由保住
 *    的第一层保证）；
 *  - 34A window.toggleAlwaysOnTop：以窗口的 isAlwaysOnTop() 为准，返回**切换后的实态**；
 *  - 34D help.getDiagnostics：交给渲染层的日志侧数据，日志读不到也不能让动作失败。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createDesktopMenuActions } = require("../lib/desktop-menu");
const { registerDesktopShellIpc } = require("../lib/desktop-shell-ipc");

function makeHarness(overrides = {}) {
  const calls = { web: [], log: [], url: "http://127.0.0.1:8010/jobs?tab=applied#top" };
  const webContents = {
    reload() {
      calls.web.push("reload");
      // Chromium 的 reload 重新加载的是**同一个 URL**：这里保持 calls.url 不变，
      // 用例据此断言"没有任何代码在刷新时改地址"。
    },
    toggleDevTools() {
      calls.web.push("toggleDevTools");
    },
    undo() {
      calls.web.push("undo");
    },
  };
  const win = {
    webContents,
    alwaysOnTop: false,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    isAlwaysOnTop() {
      return this.alwaysOnTop;
    },
    setAlwaysOnTop(value) {
      this.alwaysOnTop = Boolean(value);
      calls.web.push(["setAlwaysOnTop", this.alwaysOnTop]);
    },
    close() {
      calls.web.push("close");
    },
    minimize() {
      calls.web.push("minimize");
    },
    isMaximized() {
      return false;
    },
    maximize() {
      calls.web.push("maximize");
    },
    unmaximize() {
      calls.web.push("unmaximize");
    },
    isFullScreen() {
      return false;
    },
    setFullScreen() {},
  };
  const deps = {
    app: { getVersion: () => "2.1.0" },
    getWindow: () => (overrides.noWindow ? null : win),
    shell: {
      openPath: () => Promise.resolve(""),
      openExternal: () => Promise.resolve(),
    },
    getDataDir: () => "D:/data",
    getLogDir: () => "D:/logs",
    runUpdateCheck: () => {},
    readRecentProblems: () => ["[desktop-main.log] WARN backend slow"],
    platform: "win32",
    logLine: (line) => calls.log.push(line),
    ...overrides.deps,
  };
  const menu = createDesktopMenuActions(deps);
  return { menu, win, webContents, calls };
}

test("view.reload 调 webContents.reload()，不改 URL（刷新不丢路由的第一层）", async () => {
  const { menu, calls } = makeHarness();
  const before = calls.url;
  const outcome = await menu.run("view.reload");
  assert.equal(outcome.ok, true);
  assert.deepEqual(calls.web, ["reload"]);
  assert.equal(calls.url, before, "reload 不得经过 loadURL 之类的改地址路径");
});

test("view.toggleDevTools 调 webContents.toggleDevTools()", async () => {
  const { menu, calls } = makeHarness();
  assert.equal((await menu.run("view.toggleDevTools")).ok, true);
  assert.deepEqual(calls.web, ["toggleDevTools"]);
});

test("主窗口不可用时 reload / devtools 返回 ok:false，而不是静默没反应", async () => {
  const { menu } = makeHarness({ noWindow: true });
  const reload = await menu.run("view.reload");
  assert.equal(reload.ok, false);
  assert.match(reload.error, /页面不可用|窗口/);
  assert.equal((await menu.run("view.toggleDevTools")).ok, false);
});

test("34A window.toggleAlwaysOnTop：翻转窗口实态并返回切换后的值", async () => {
  const { menu, win, calls } = makeHarness();
  const first = await menu.run("window.toggleAlwaysOnTop");
  assert.equal(first.ok, true);
  assert.deepEqual(first.result, { alwaysOnTop: true });
  assert.equal(win.alwaysOnTop, true);
  assert.deepEqual(calls.web, [["setAlwaysOnTop", true]]);

  const second = await menu.run("window.toggleAlwaysOnTop");
  assert.deepEqual(second.result, { alwaysOnTop: false });
  assert.equal(win.alwaysOnTop, false);
});

test("34A：窗口已被外部置顶时，第一次切换是取消勾选（状态来自窗口，不是渲染层记忆）", async () => {
  const { menu, win } = makeHarness();
  win.alwaysOnTop = true;
  const outcome = await menu.run("window.toggleAlwaysOnTop");
  assert.deepEqual(outcome.result, { alwaysOnTop: false });
  assert.equal(win.alwaysOnTop, false);
});

test("34A：平台不支持 setAlwaysOnTop 时如实返回 ok:false", async () => {
  const { menu, win } = makeHarness();
  win.setAlwaysOnTop = undefined;
  const outcome = await menu.run("window.toggleAlwaysOnTop");
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /不支持/);
});

test("34D help.getDiagnostics：版本 / 平台 / 目录 / 最近告警都带上", async () => {
  const { menu } = makeHarness();
  const outcome = await menu.run("help.getDiagnostics");
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.result, {
    version: "2.1.0",
    platform: "win32",
    dataDir: "D:/data",
    logDir: "D:/logs",
    problems: ["[desktop-main.log] WARN backend slow"],
  });
});

test("34D：日志读取抛错时仍然返回 ok:true（少一段日志，不要让整个菜单项失败）", async () => {
  const { menu, calls } = makeHarness({
    deps: {
      readRecentProblems: () => {
        throw new Error("EACCES: denied");
      },
    },
  });
  const outcome = await menu.run("help.getDiagnostics");
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.result.problems, []);
  assert.equal(
    calls.log.some((line) => line.includes("recent problems unavailable")),
    true,
    "读日志失败要留一条诊断日志",
  );
});

test("34D：日志目录不可用时 logDir 为 null，动作仍成功", async () => {
  const { menu } = makeHarness({ deps: { getLogDir: () => null } });
  const outcome = await menu.run("help.getDiagnostics");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.logDir, null);
});

// ---- lib/desktop-shell-ipc.js 的接线（#34A / #34F / #34D） --------------------

function makeIpcHarness() {
  const handlers = {};
  const listeners = {};
  const win = {
    webContents: { id: "main" },
    alwaysOnTop: false,
    isDestroyed: () => false,
    isAlwaysOnTop() {
      return this.alwaysOnTop;
    },
  };
  const titleBar = {
    windowState: () => ({ maximized: true, fullscreen: false }),
    applyTheme: () => {},
  };
  const ipcMain = {
    handle: (name, handler) => {
      handlers[name] = handler;
    },
    on: (name, handler) => {
      listeners[name] = handler;
    },
  };
  registerDesktopShellIpc({
    ipcMain,
    app: { getVersion: () => "2.1.0" },
    getWindow: () => win,
    shell: { openPath: () => Promise.resolve(""), openExternal: () => Promise.resolve() },
    getDataDir: () => "D:/data",
    getLogDir: () => "D:/logs",
    runUpdateCheck: () => {},
    titleBar,
    logLine: () => {},
  });
  return { handlers, listeners, win };
}

const trustedNow = () => {
  const harness = makeIpcHarness();
  return { ...harness, sender: harness.win.webContents };
};

test("窗口快照带上置顶实态（#34A）：每次都重新读窗口，不是缓存", async () => {
  const { handlers, win, sender } = trustedNow();
  const state = handlers["desktop:get-window-state"];
  assert.equal((await state({ sender })).alwaysOnTop, false);
  win.alwaysOnTop = true;
  const after = await state({ sender });
  assert.equal(after.alwaysOnTop, true);
  assert.equal(after.maximized, true, "原有窗口状态字段不能丢");
});

test("可编辑焦点经 IPC 报给主进程后回填进快照（#34F 两边同源）", async () => {
  const { handlers, listeners, sender } = trustedNow();
  const state = handlers["desktop:get-window-state"];
  assert.equal((await state({ sender })).editableFocus, false);
  listeners["desktop:editable-focus"]({ sender }, true);
  assert.equal((await state({ sender })).editableFocus, true);
  listeners["desktop:editable-focus"]({ sender }, false);
  assert.equal((await state({ sender })).editableFocus, false);
});

test("非主窗口发来的可编辑焦点消息被丢弃（最小暴露面）", async () => {
  const { handlers, listeners, sender } = trustedNow();
  listeners["desktop:editable-focus"]({ sender: { rogue: true } }, true);
  assert.equal((await handlers["desktop:get-window-state"]({ sender })).editableFocus, false);
});

test("非主窗口请求窗口快照 / 诊断信息一律被拒", async () => {
  const { handlers } = trustedNow();
  const rogue = { sender: { rogue: true } };
  const state = await handlers["desktop:get-window-state"](rogue);
  assert.deepEqual(state, {
    maximized: false,
    fullscreen: false,
    alwaysOnTop: false,
    editableFocus: false,
  });
  const diagnostics = await handlers["desktop:menu-action"](rogue, {
    action: "help.getDiagnostics",
  });
  assert.equal(diagnostics.ok, false);
});

test("help.getDiagnostics 经 IPC 走通（日志目录为空时 problems 为空数组）", async () => {
  const { handlers, sender } = trustedNow();
  const reply = await handlers["desktop:menu-action"]({ sender }, {
    action: "help.getDiagnostics",
  });
  assert.equal(reply.ok, true);
  assert.equal(reply.result.version, "2.1.0");
  assert.equal(reply.result.dataDir, "D:/data");
  assert.deepEqual(reply.result.problems, []);
});
