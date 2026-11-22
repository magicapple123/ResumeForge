// SPDX-License-Identifier: Apache-2.0
"use strict";

// will-quit 兜底：壳要退出时，后端必须跟着走（lib/backend-emergency-stop.js）。
//
// 为什么这一层单独有用例：before-quit 的停止是异步的，而且它的结论依赖 manager 里的
// 状态。2.3.1 门禁（run 45017991307，四个 Linux 矩阵）抓到的形态是"壳 177ms 退了、
// uvicorn 还在 accept"——异步那条路只要判错一次，用户机器上就留下一个孤儿后端。
// 兜底不参与判断，只保证"壳走，后端也走"。
//
// 全部离线：killFn（信号）、platform（决定要不要复核 /proc）、readCmdlineFn（身份证据）
// 都是注入的替身 —— **任何一条用例都不许真的给某个 pid 发信号**（backend-stop 的
// 同名注入点就是为这件事存在的，评审在 macOS/Linux 上被真的 SIGTERM 过一次）。
//
// Run with: node --test scripts/test-backend-emergency-stop.js

const assert = require("assert");
const { test } = require("node:test");

const {
  TERMINATE_SIGNAL,
  recordedTargets,
  terminateRecordedBackend,
} = require("../lib/backend-emergency-stop");
const { createQuitLifecycle } = require("../lib/quit-lifecycle");

/** 记录信号的替身：不碰真实进程表。 */
function signalSpy() {
  const signals = [];
  const killFn = (pid, signal) => signals.push({ pid, signal });
  return { signals, killFn };
}

function flush() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

test("异步停止未确认：对记录里的 pid 发一次 SIGTERM", () => {
  const { signals, killFn } = signalSpy();
  const manager = {
    child: null,
    // 启动器交接来的真后端；Linux 上命令行当场复核，所以这里给一份像样的证据。
    adoptedRecord: { pid: 2749, startedAtUnix: null, startSignature: "Mon Nov 23 10:57:52 2026" },
    adoptedPid: 2749,
  };

  const report = terminateRecordedBackend(manager, {
    killFn,
    platform: "linux",
    readCmdlineFn: () => "backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 38223",
  });

  assert.deepStrictEqual(signals, [{ pid: 2749, signal: TERMINATE_SIGNAL }],
    "记录的 pid 就是现场那个 uvicorn（38223 那次的 pid=2749）");
  assert.equal(report.signaled.length, 1);
  assert.equal(report.signaled[0].source, "record");
  assert.match(report.log.join("\n"), /SIGTERM pid=2749/);
});

test("异步停止已确认：一个信号都不发（幂等）", () => {
  const { signals, killFn } = signalSpy();
  const manager = {
    child: null,
    adoptedRecord: { pid: 2749, startedAtUnix: null, startSignature: "sig" },
    adoptedPid: 2749,
  };

  const report = terminateRecordedBackend(manager, {
    killFn,
    platform: "linux",
    readCmdlineFn: () => assert.fail("已确认停止就不该再去读命令行"),
    stopConfirmed: true,
  });

  assert.deepStrictEqual(signals, [], "已确认停止之后再发 SIGTERM 等于凭空制造一次失败退出");
  assert.equal(report.signaled.length, 0);
  assert.match(report.log.join("\n"), /已确认/);
});

test("没有任何记录 pid：什么都不做，也不抛", () => {
  const { signals, killFn } = signalSpy();
  // 没有 child、没有记录、没有 adoptedPid——"不知道后端在哪"不等于"可以随便杀一个"。
  assert.doesNotThrow(() =>
    terminateRecordedBackend(
      { child: null, adoptedRecord: null, adoptedPid: null },
      { killFn, platform: "linux", readCmdlineFn: () => assert.fail("没有 pid 就不该读命令行") },
    ),
  );
  const report = terminateRecordedBackend({}, { killFn, platform: "linux" });
  assert.deepStrictEqual(signals, []);
  assert.equal(report.signaled.length, 0);
  assert.match(report.log.join("\n"), /没有记录中的后端 pid/);
  // manager 本身缺失（getBackend() 返回 null）也不能抛：这时候后端根本没被托管。
  assert.doesNotThrow(() => terminateRecordedBackend(null, { killFn }));
});

test("Linux 上记录里的 pid 命令行不是后端：不发信号（不许误杀回收的 pid）", () => {
  const { signals, killFn } = signalSpy();
  const manager = { child: null, adoptedRecord: { pid: 2749 }, adoptedPid: 2749 };

  const report = terminateRecordedBackend(manager, {
    killFn,
    platform: "linux",
    readCmdlineFn: () => "node /home/user/other-server.js --port 38223",
  });

  assert.deepStrictEqual(signals, [], "RR-02：没有身份证据就不许杀");
  assert.equal(report.skipped.length, 1);
  assert.match(report.log.join("\n"), /reason=命令行不是后端/);
});

test("Linux 上读不到 /proc 命令行（进程已退出）：不发信号，也不抛", () => {
  const { signals, killFn } = signalSpy();
  const manager = { child: null, adoptedRecord: { pid: 2749 }, adoptedPid: 2749 };

  const report = terminateRecordedBackend(manager, {
    killFn,
    platform: "linux",
    readCmdlineFn: () => null,
  });

  assert.deepStrictEqual(signals, []);
  assert.match(report.log.join("\n"), /读不到 \/proc 命令行/);
});

test("自己 spawn 的 child 活着时用 child 的 pid（句柄钉住，不重复杀同一次）", () => {
  const { signals, killFn } = signalSpy();
  const targets = recordedTargets({ child: { pid: 5001, exitCode: null, signalCode: null } });
  assert.deepStrictEqual(targets, [{ pid: 5001, source: "child" }]);

  const report = terminateRecordedBackend(
    { child: { pid: 5001, exitCode: null, signalCode: null }, adoptedPid: 5001 },
    { killFn, platform: "linux", readCmdlineFn: () => assert.fail("child 由句柄钉住，不需要 /proc") },
  );

  assert.deepStrictEqual(signals, [{ pid: 5001, signal: TERMINATE_SIGNAL }], "同一个 pid 只发一次");
  assert.equal(report.signaled[0].source, "child");
});

test("已退出的 child 不再是目标（exitCode 已定，pid 可能已经被回收）", () => {
  assert.deepStrictEqual(recordedTargets({ child: { pid: 5001, exitCode: 0, signalCode: null } }), []);
  assert.deepStrictEqual(recordedTargets({ child: { pid: 5001, exitCode: null, signalCode: "SIGTERM" } }), []);
});

test("kill 抛 ESRCH（进程刚好自己退了）只记一行，不抛", () => {
  const manager = {
    child: null,
    adoptedRecord: { pid: 2749 },
    adoptedPid: 2749,
    killFn: () => {
      const err = new Error("kill ESRCH");
      err.code = "ESRCH";
      throw err;
    },
  };
  const report = terminateRecordedBackend(manager, {
    platform: "linux",
    readCmdlineFn: () => "python -m uvicorn app.main:app",
  });
  assert.equal(report.signaled.length, 0);
  assert.match(report.log.join("\n"), /reason=ESRCH/);
});

// --- 接线：quit-lifecycle 真的注册了 will-quit，并用上了这条兜底 -----------------

/**
 * 造一个只够跑退出流程的 lifecycle：假 app 记录事件处理器，假 backend 由用例决定
 * stop() 的结论。`killFn` 走 manager 的缝（与生产里 backend-stop 同一个注入点），
 * 所以这条用例在任何平台上都不会真的发信号。
 */
function makeQuitHarness({ backend }) {
  const logs = [];
  const handlers = {};
  const app = {
    quitCalls: 0,
    on(name, handler) {
      handlers[name] = handler;
    },
    quit() {
      app.quitCalls += 1;
    },
  };
  const lifecycle = createQuitLifecycle({
    app,
    dialog: { showErrorBox: () => {} },
    logLine: (line) => logs.push(line),
    getBackend: () => backend,
    getWindow: () => null,
    getRestartTimer: () => null,
    setQuitting: () => {},
    getLocale: () => "zh",
    installerWaitCommand: (installerPath) => ({ file: "cmd", args: [installerPath] }),
    requireChildProcess: () => ({ spawn: () => ({ unref() {}, on() {} }) }),
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
  });
  return { app, handlers, lifecycle, logs };
}

test("quit-lifecycle 注册了 will-quit，并在异步停止未确认时补一刀 SIGTERM", async () => {
  const { signals, killFn } = signalSpy();
  const backend = {
    url: "http://127.0.0.1:38223",
    killFn,
    child: { pid: 5001, exitCode: null, signalCode: null },
    stop() {
      return Promise.resolve({ ok: false, reason: "启动器已退出且没有可核验的进程记录", verified: false });
    },
  };
  const { handlers, lifecycle } = makeQuitHarness({ backend });

  assert.equal(typeof handlers["will-quit"], "function", "兜底必须真的挂在 will-quit 上");

  // 走一遍真实的 before-quit：异步停止报告"未确认"，quit 被放行。
  lifecycle.handleBeforeQuit({ preventDefault() {} });
  await flush();
  assert.deepStrictEqual(signals, [], "before-quit 阶段不该有兜底信号（那是异步路径的活）");

  handlers["will-quit"]();
  assert.deepStrictEqual(signals, [{ pid: 5001, signal: TERMINATE_SIGNAL }],
    "异步停止没确认成功 —— 壳退出前必须同步补一刀");
});

test("quit-lifecycle 的 will-quit 在异步停止已确认时不发任何信号", async () => {
  const { signals, killFn } = signalSpy();
  const backend = {
    url: "http://127.0.0.1:38223",
    killFn,
    child: { pid: 5001, exitCode: null, signalCode: null },
    stop() {
      return Promise.resolve({ ok: true, reason: "", verified: true });
    },
  };
  const { handlers, lifecycle } = makeQuitHarness({ backend });

  lifecycle.handleBeforeQuit({ preventDefault() {} });
  await flush();
  handlers["will-quit"]();
  assert.deepStrictEqual(signals, [], "确认已停之后再补刀只会制造一次假失败");
});

test("will-quit 在没有后端时什么也不做（启动失败/数据目录中止那条路）", () => {
  const { handlers } = makeQuitHarness({ backend: null });
  assert.doesNotThrow(() => handlers["will-quit"]());
});
