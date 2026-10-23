// SPDX-License-Identifier: Apache-2.0
"use strict";

// 启动失败路径探针（desktop/main.js）：从 test-lifecycle.js 按关注点拆出。
//
// 这里只钉"后端起不来时用户看到什么、应用还能不能退出"——可操作对话框、日志
// 目录、以及在对话框弹不出来 / openPath 报错这些**失败路径的失败路径**下仍然
// 必须退出。退出生命周期本身（before-quit / 安装包派生 / 崩溃重启预算）留在
// test-lifecycle.js，两个文件共用同一份 lifecycle-harness.js。
//
// Run with: node --test "scripts/test-*.js"

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");
const { flush, loadMain, waitForShellReady } = require("./lifecycle-harness");

// --- 启动失败必须给出可操作的出口（日志失效链） -------------------------------

// 让 startBackend() 抛错：当后端永远起不来时，用户看到的不该只是启动图上的
// 一行红字 + 一个需要手动复制的路径。
function makeStartupFailingMain() {
  const loaded = loadMain();
  loaded.state.startBackend = () =>
    Promise.resolve().then(() => {
      throw new Error("Backend exited early (code=1). See C:/logs/desktop-backend.log");
    });
  return loaded;
}

test("startup failure opens a NATIVE dialog with 'open log dir' and 'exit'", async () => {
  const loaded = makeStartupFailingMain();
  try {
    await flush();
    await flush();

    assert.strictEqual(loaded.events.messageBoxes.length, 1,
      "a failed startup must surface exactly one actionable dialog");
    const box = loaded.events.messageBoxes[0];
    // 注意展开：box.buttons 是在 VM 上下文里造的数组，跨 realm 的 deepStrictEqual
    // 会因为原型不同而失败（值一样也不行）。
    assert.deepStrictEqual([...box.buttons], ["打开日志目录", "退出"],
      "the dialog must offer the two actions the user can actually take");
    assert.match(box.detail, /Code=1|code=1/i,
      "the dialog must carry the real failure reason, not a generic line");
    // 不能退回 showErrorBox：它没有按钮，用户只能看着启动图。
    assert.strictEqual(loaded.events.errorBoxes.length, 0,
      "the startup failure path must not use the button-less showErrorBox");
    // 默认按钮是「打开日志目录」（回车即可去看日志），取消（Esc）= 退出：
    // 两个结果都会退出应用，区别只是有没有顺手把日志目录打开。
    assert.strictEqual(box.defaultId, 0);
    assert.strictEqual(box.cancelId, 1);

    // 「退出」真的退出：app.quit() 被调用（默认 response=1）。
    assert.ok(loaded.events.quitCalls.length >= 1, "choosing 退出 must really quit");
    // 关窗不能被 close handler 拦成"藏到托盘"——那正是"退不掉"的成因。
    const window = loaded.windowInstances[0];
    assert.ok(window && typeof window.handlers.close === "function",
      "the window close handler must be registered");
    let prevented = 0;
    window.handlers.close({ preventDefault: () => (prevented += 1) });
    assert.strictEqual(prevented, 0,
      "after a failed startup the window close must not be turned into hide-to-tray");

    // 双保险：启动图仍然收到 error 阶段，用户即使看不见对话框也知道原因。
    assert.ok(
      loaded.events.stages.some((payload) => payload.stage === "error"),
      "the splash must still be told about the error",
    );
  } finally {
    loaded.cleanup();
  }
});

test("startup failure: 'open log dir' opens the resolved log directory, then quits", async () => {
  const loaded = makeStartupFailingMain();
  // 选「打开日志目录」（index 0）。whenReady 的微任务还没跑，改这里安全。
  loaded.state.messageBoxResponse = 0;
  try {
    await flush();
    await flush();

    assert.strictEqual(loaded.events.openPathCalls.length, 1,
      "the log directory must be opened for the user");
    const opened = loaded.events.openPathCalls[0];
    const userDataDir = loaded.appStub.getPath("userData");
    assert.ok(
      opened.includes(userDataDir) && opened.endsWith("logs"),
      `the opened path must be the shell's log directory (got ${opened})`,
    );
    // 打开目录不修复失败：仍然要收摊，否则下一次启动会撞上单实例锁再失败一次。
    assert.ok(loaded.events.quitCalls.length >= 1, "opening the log dir still quits");
  } finally {
    loaded.cleanup();
  }
});

// --- C-10: 桌面测试不许写真实用户目录 -----------------------------------------

test("loading main.js writes its diagnostics log under the test temp dir, not the user profile", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const userDataDir = loaded.appStub.getPath("userData");
    const logFile = path.join(userDataDir, "ResumeForge", "runtime", "logs", "desktop-main.log");
    assert.ok(fs.existsSync(logFile),
      `the shell log must land under the test temp dir (${logFile})`);
  } finally {
    loaded.cleanup();
  }
});

// --- 启动失败对话框的边界：弹不出来 / 打不开目录，都必须仍然退出 ---------------
//
// 上面两条钉的是"对话框能弹出来时给出两个按钮"。这一段钉的是**失败路径的失败路径**：
// 系统策略把对话框静默掉、Electron 版本没有 showMessageBoxSync、openPath 报错——
// 这三种情况下应用绝不能停在"启动图红着、窗口关不掉、进程还在"的半启动状态。

// main.js 的日志落点：harness 把 LOCALAPPDATA 指到临时目录，落点规则与
// main.js::runtimeDir 一致（win: <tmp>/ResumeForge/runtime，darwin: <tmp>/runtime）。
function shellLogFile(loaded) {
  const base = loaded.appStub.getPath("userData");
  const runtimeDir = process.platform === "darwin"
    ? path.join(base, "runtime")
    : path.join(base, "ResumeForge", "runtime");
  return path.join(runtimeDir, "logs", "desktop-main.log");
}

function readShellLog(loaded) {
  try {
    return fs.readFileSync(shellLogFile(loaded), "utf-8");
  } catch {
    return "";
  }
}

test("startup failure: a dialog that cannot be shown still quits and leaves a trace", async () => {
  const loaded = makeStartupFailingMain();
  // 系统策略把对话框挡掉：showMessageBoxSync 抛异常。
  loaded.state.messageBoxThrows = true;
  try {
    await flush();
    await flush();

    assert.strictEqual(loaded.events.messageBoxes.length, 1,
      "the dialog must still be attempted (the failure reason is in it)");
    assert.ok(loaded.events.quitCalls.length >= 1,
      "a blocked dialog must not leave the shell half-started");
    // 没有按钮可选，就不该去打开目录。
    assert.strictEqual(loaded.events.openPathCalls.length, 0);

    // 用户点不着对话框时，日志是唯一证据：必须留下"对话框不可用"这一行。
    assert.match(readShellLog(loaded), /startup failure dialog unavailable/,
      "the shell log must record why the user never saw the dialog");
    assert.match(readShellLog(loaded), /Backend exited early/,
      "the real failure reason must still be logged for support");

    // 也不能被 close handler 拦成"藏到托盘"。
    const window = loaded.windowInstances[0];
    assert.ok(window && typeof window.handlers.close === "function");
    let prevented = 0;
    window.handlers.close({ preventDefault: () => (prevented += 1) });
    assert.strictEqual(prevented, 0,
      "after a failed startup the window close must not become hide-to-tray");
  } finally {
    loaded.cleanup();
  }
});

test("startup failure: an Electron without showMessageBoxSync still quits", async () => {
  const loaded = makeStartupFailingMain();
  // 连方法都不存在（旧版 Electron / 平台不支持）：只能记日志 + 退出。
  delete loaded.dialogStub.showMessageBoxSync;
  try {
    await flush();
    await flush();

    assert.strictEqual(loaded.events.messageBoxes.length, 0);
    assert.strictEqual(loaded.events.openPathCalls.length, 0);
    assert.ok(loaded.events.quitCalls.length >= 1,
      "a shell without showMessageBoxSync must still exit instead of hanging on the splash");
  } finally {
    loaded.cleanup();
  }
});

test("startup failure: a rejected openPath only logs and still quits", async () => {
  const loaded = makeStartupFailingMain();
  loaded.state.messageBoxResponse = 0; // 「打开日志目录」
  loaded.state.openPathRejects = "EPERM: cannot open directory";
  try {
    await flush();
    await flush();

    assert.strictEqual(loaded.events.openPathCalls.length, 1);
    assert.ok(loaded.events.quitCalls.length >= 1,
      "a failed openPath must not change the exit decision");
    await flush(); // 让 rejected promise 的 catch 落地
    assert.match(readShellLog(loaded), /open log dir failed/,
      "a rejected openPath must be recorded, not swallowed silently");
    assert.match(readShellLog(loaded), /EPERM/);
  } finally {
    loaded.cleanup();
  }
});

test("startup failure: openPath's error STRING does not change the exit decision", async () => {
  // Electron 的 openPath 用"返回错误字符串"报告失败（不是 reject）：这条路径也要退出，
  // 且不能因为没人读那个字符串而抛成 unhandled rejection。
  const loaded = makeStartupFailingMain();
  loaded.state.messageBoxResponse = 0;
  loaded.state.openPathError = "EPERM: cannot open directory";
  try {
    await flush();
    await flush();

    assert.strictEqual(loaded.events.openPathCalls.length, 1);
    assert.ok(loaded.events.quitCalls.length >= 1,
      "an un-openable log dir must still end in a quit");
    const window = loaded.windowInstances[0];
    let prevented = 0;
    window.handlers.close({ preventDefault: () => (prevented += 1) });
    assert.strictEqual(prevented, 0);
  } finally {
    loaded.cleanup();
  }
});

test("startup failure: a shell without openPath still quits", async () => {
  const loaded = makeStartupFailingMain();
  loaded.state.messageBoxResponse = 0;
  delete loaded.shellStub.openPath;
  try {
    await flush();
    await flush();

    assert.strictEqual(loaded.events.openPathCalls.length, 0);
    assert.ok(loaded.events.quitCalls.length >= 1,
      "a missing shell.openPath must not turn the failure path into a crash");
  } finally {
    loaded.cleanup();
  }
});

test("control: before any failure, closing the window still hides to tray", async () => {
  // 这条是上面几条的对照组：它证明 close handler **确实**会 preventDefault。
  // 否则"启动失败后 prevented === 0"可能只是因为 handler 根本没接上，而不是
  // quitting 生效。
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    assert.ok(window && typeof window.handlers.close === "function",
      "the window close handler must be registered");

    let prevented = 0;
    let hidden = 0;
    window.hide = () => (hidden += 1);
    window.handlers.close({ preventDefault: () => (prevented += 1) });

    assert.strictEqual(prevented, 1, "a plain window close must be turned into hide-to-tray");
    assert.strictEqual(hidden, 1);
  } finally {
    loaded.cleanup();
  }
});
