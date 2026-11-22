// SPDX-License-Identifier: Apache-2.0
"use strict";

// R3-04 probes: hide-before-stop and the five quit stage stamps.
//
// These drive lib/quit-lifecycle.js directly (the module requires no electron,
// every collaborator is injected), so the ordering between hide() and stop()
// and the exact log shape are asserted without a VM, a window or a backend.
// The end-to-end wiring through desktop/main.js is covered by test-lifecycle.js.
//
// Run with: node --test scripts/test-quit-timing.js

const assert = require("assert");
const { test } = require("node:test");
const { createQuitLifecycle } = require("../lib/quit-lifecycle");

function flush() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

function makeWindow(overrides = {}) {
  const win = {
    hidden: 0,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    hide() {
      this.hidden += 1;
      win.order.push("hide");
    },
    order: [],
    ...overrides,
  };
  return win;
}

/**
 * Builds a lifecycle with a fake backend whose stop() stamps the same three
 * stages lib/backend-stop stamps in production, and a fake window that records
 * every hide() into a shared order array.
 */
function makeHarness(overrides = {}) {
  const logs = [];
  const order = [];
  const app = {
    quitCalls: 0,
    quit() {
      app.quitCalls += 1;
      order.push("quit");
    },
  };
  const win = makeWindow({ order });
  const backend = {
    url: "http://127.0.0.1:8010",
    stop() {
      order.push("stop");
      if (this.quitTimeline) {
        this.quitTimeline.mark("taskkill exit");
        this.quitTimeline.mark("process gone");
        this.quitTimeline.mark("port probe");
      }
      return Promise.resolve({ ok: true, reason: "", verified: true });
    },
  };
  const spawned = [];
  const lifecycle = createQuitLifecycle({
    app,
    dialog: { showErrorBox: () => {} },
    logLine: (line) => logs.push(line),
    getBackend: () => ("backend" in overrides ? overrides.backend : backend),
    getWindow: overrides.getWindow ?? (() => win),
    getRestartTimer: () => null,
    setQuitting: () => {},
    getLocale: () => "zh",
    installerWaitCommand: (installerPath) => ({ file: "cmd", args: [installerPath] }),
    requireChildProcess: () => ({
      spawn(file, args) {
        order.push("installer-spawn");
        const child = { unref() {}, on() {} };
        spawned.push({ file, args, child });
        return child;
      },
    }),
    // Fake timer venue: the stop cap must never fire in these tests.
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
  });
  return { app, backend, lifecycle, logs, order, spawned, win };
}

function quit(lifecycle) {
  const event = { prevented: 0, preventDefault() { this.prevented += 1; } };
  lifecycle.handleBeforeQuit(event);
  return event;
}

test("hide() runs before stop(): the window is gone while the backend stops (R3-A)", async () => {
  const { lifecycle, win, order, app } = makeHarness();
  quit(lifecycle);
  assert.deepStrictEqual(order.slice(0, 2), ["hide", "stop"],
    `the window must be hidden before the backend stop (order: ${order.join(" -> ")})`);
  assert.strictEqual(win.hidden, 1);
  await flush();
  assert.strictEqual(order[order.length - 1], "quit", "quit is released last");
  assert.strictEqual(app.quitCalls, 1);
});

test("the second before-quit pass does not hide again and does not re-stop", async () => {
  const { lifecycle, win, order } = makeHarness();
  quit(lifecycle);
  await flush();
  const event = quit(lifecycle);
  assert.strictEqual(win.hidden, 1, "hide must happen exactly once per quit");
  assert.strictEqual(order.filter((step) => step === "stop").length, 1);
  assert.strictEqual(event.prevented, 0, "the resuming pass lets quit through");
});

test("hide() never routes through close(): no close handler, no destroy (guard)", async () => {
  const { lifecycle, win } = makeHarness();
  // The real risk: hide() triggering main.js' close handler would re-open the
  // ask-on-close card (or flip the quit into a hide-to-tray). The fake window
  // makes any close() call visible; nothing may reach it.
  win.close = () => {
    win.order.push("close");
    win.destroyed = true;
  };
  quit(lifecycle);
  await flush();
  assert.strictEqual(win.order.includes("close"), false, "hide must not call close()");
  assert.strictEqual(win.destroyed, false, "the window is only hidden, never destroyed");
});

test("a destroyed window is skipped, a missing window is skipped, stop still runs", async () => {
  const destroyed = makeHarness();
  destroyed.win.destroyed = true;
  quit(destroyed.lifecycle);
  assert.strictEqual(destroyed.win.hidden, 0, "a destroyed window is not hidden");
  assert.ok(destroyed.order.includes("stop"), "the stop must still run");

  const windowless = makeHarness({ getWindow: () => null });
  quit(windowless.lifecycle);
  assert.ok(windowless.order.includes("stop"), "a windowless quit still stops the backend");
  await flush();
  assert.strictEqual(windowless.app.quitCalls, 1);
});

test("a hide() that throws is logged and never holds the quit", async () => {
  const { lifecycle, win, logs, app } = makeHarness();
  win.hide = () => {
    throw new Error("window is gone");
  };
  quit(lifecycle);
  await flush();
  assert.ok(logs.some((line) => /main window hide failed/.test(line)), "the failure is logged");
  assert.strictEqual(app.quitCalls, 1, "the quit still completes");
});

test("the five stage stamps land as one readable summary line (R3-04 acceptance)", async () => {
  const { lifecycle, logs } = makeHarness();
  quit(lifecycle);
  await flush();

  const marks = logs.filter((line) => /^quit timing: /.test(line));
  for (const stage of ["stop requested", "window hidden", "taskkill exit", "process gone", "port probe"]) {
    assert.ok(marks.some((line) => line.startsWith(`quit timing: ${stage} +`)),
      `missing stage stamp: ${stage} (got: ${marks.join(" | ")})`);
  }

  const summary = marks[marks.length - 1];
  assert.match(
    summary,
    /^quit timing: stop requested at \+\d+ms, taskkill exit \+\d+ms, process gone \+\d+ms, port probe \+\d+ms, releasing quit \+\d+ms$/,
    `the acceptance line must be readable in one go (got: ${summary})`,
  );

  // Stamps are monotonic: a summary that reports a later stage as faster than
  // an earlier one would make the numbers useless for diagnosis.
  const numbers = summary.match(/\+(\d+)ms/g).map((token) => Number(token.slice(1, -2)));
  for (let index = 1; index < numbers.length; index += 1) {
    assert.ok(numbers[index] >= numbers[index - 1], `stamps must not go backwards: ${summary}`);
  }
});

test("a quit with no backend reports n/a instead of inventing numbers (R3-04)", async () => {
  const { lifecycle, logs } = makeHarness({ backend: null });
  quit(lifecycle);
  await flush();
  const summary = logs.filter((line) => /^quit timing: /.test(line)).pop();
  assert.match(summary, /taskkill exit n\/a/, "no backend -> no taskkill stage");
  assert.match(summary, /process gone n\/a/);
  assert.match(summary, /releasing quit \+\d+ms$/, "the release itself is always measured");
});

test("install path still hides first and spawns only after the stop completes", async () => {
  const { lifecycle, order, spawned } = makeHarness();
  lifecycle.setPendingInstallerPath("C:/temp/ResumeForge-Setup-0.19.0.exe");
  quit(lifecycle);
  assert.deepStrictEqual(order.slice(0, 2), ["hide", "stop"],
    "the install path hides first, exactly like a plain quit");
  await flush();
  assert.strictEqual(spawned.length, 1, "the installer is still spawned after the stop");
  assert.ok(order.indexOf("installer-spawn") > order.indexOf("stop"),
    `installer must spawn after the stop (order: ${order.join(" -> ")})`);
});

test("A1：补杀监听进程的那一行证据确实进了 desktop-main.log", async () => {
  // backend-stop / backend-listener-rescue 只**产出**那一行（outcome.rescueLog），真正写盘
  // 是在这里。少了这一步，日志里就查不到"端口 → pid → 命令行 → 结果"，下次再出现
  // 「端口仍可连接」时又只能靠猜（2026-11-21 那次就是这样）。
  const rescueLog =
    'backend stop rescued listener (port=51152; pid=2222; command="python -m uvicorn app.main:app"; result=已补杀，端口已关闭)';
  const backend = {
    url: "http://127.0.0.1:51152",
    stop: () => Promise.resolve({ ok: true, reason: "", verified: true, rescued: true, rescueLog }),
  };
  const { lifecycle, logs, app } = makeHarness({ backend });
  quit(lifecycle);
  await flush();
  assert.ok(logs.includes(rescueLog), `补杀证据必须原样落进日志（实际：${JSON.stringify(logs)}）`);
  assert.strictEqual(app.quitCalls, 1, "记这一行不影响退出本身");
});
