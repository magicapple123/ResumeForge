// SPDX-License-Identifier: Apache-2.0
"use strict";

// backend-manager 的停止路径与进程身份核验（RR-02）——从 test-backend-manager.js
// 拆出（行数预算）。用例用注入的假进程表驱动，不碰真实进程。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");
const { makeTempRoot, flush } = require("./testkit");

const { BackendManager } = require("../backend-manager");

const IS_WIN = process.platform === "win32";

function makeManager(root, options = {}) {
  return new BackendManager(root, path.join(root, "runtime"), {
    packaged: false,
    // 任何 stop 路径都不许真的给 pid 发信号：Windows 走注入的 spawnFn，
    // POSIX 走这里的 killFn（否则在 macOS/Linux 上跑测试会杀到真实进程 4321）。
    killFn: () => {},
    ...options,
  });
}

// --- 4. stop() with an adopted pid ---------------------------------------------

const BACKEND_COMMAND = '"C:\\payload\\python\\python.exe" -m uvicorn app.main:app --port 8010';

// A fake process table for the identity probes: `processes` maps pid -> record
// or undefined. `onQuery` can mutate it (e.g. simulate the process exiting when
// taskkill runs).
function identityExec(processes, { onQuery } = {}) {
  return async (file, args) => {
    const script = args[args.length - 1];
    const match = /Get-Process -Id (\d+)/.exec(String(script));
    const pid = Number(match ? match[1] : args[1]);
    const entry = processes[pid];
    if (onQuery) onQuery(pid);
    if (!entry) {
      return IS_WIN ? { code: 0, stdout: "null", stderr: "" } : { code: 1, stdout: "", stderr: "" };
    }
    if (IS_WIN) {
      return {
        code: 0,
        stdout: JSON.stringify({
          process_id: pid,
          started_at_unix: entry.startedAtUnix,
          command_line: entry.commandLine,
        }),
        stderr: "",
      };
    }
    if (args[2] === "lstart=") {
      return { code: 0, stdout: `${entry.startSignature || "Mon Oct 13 22:00:00 2026"}\n` };
    }
    return { code: 0, stdout: `${entry.commandLine}\n` };
  };
}

function taskkillSpawn(spawnCalls, { kills = [] } = {}) {
  return (file, args, options) => {
    spawnCalls.push({ file, args, options });
    return {
      on(event, cb) {
        if (event === "exit") setTimeout(cb, 0);
      },
    };
  };
}

test("stop() kills the adopted backend tree when the launcher already exited", async () => {
  const root = makeTempRoot("stop-adopted");
  try {
    const processes = {
      4321: { startedAtUnix: 1760000000, commandLine: BACKEND_COMMAND },
    };
    const spawnCalls = [];
    // taskkill removes the process from the table, like the real thing does.
    const spawnFn = (file, args, options) => {
      spawnCalls.push({ file, args, options });
      if (args && args[0] === "/pid") delete processes[Number(args[1])];
      return { on(event, cb) { if (event === "exit") setTimeout(cb, 0); } };
    };
    const manager = makeManager(root, { spawnFn, execFileFn: identityExec(processes) });
    manager.adoptedPid = 4321;
    manager.adoptedRecord = { pid: 4321, startedAtUnix: 1760000000, startSignature: null };
    manager.child = { exitCode: 0, signalCode: null, pid: 999 }; // launcher already gone
    manager.onUnexpectedExit = () => {
      throw new Error("stop must not trigger crash supervision");
    };

    const outcome = await manager.stop();
    assert.strictEqual(outcome.ok, true, "a verified stop reports success");
    assert.strictEqual(spawnCalls.length, 1, "the adopted tree must be terminated");
    if (IS_WIN) {
      assert.strictEqual(spawnCalls[0].file, "taskkill");
      assert.deepStrictEqual(spawnCalls[0].args, ["/pid", "4321", "/T", "/F"]);
    }
    assert.strictEqual(manager.logStream, null, "the log handle must be closed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stop() never kills a pid whose identity no longer matches (PID reuse)", async () => {
  const root = makeTempRoot("stop-recycled");
  try {
    // Same pid, different process: a stranger that must survive.
    const processes = {
      4321: { startedAtUnix: 1760099999, commandLine: "C:\\Windows\\explorer.exe" },
    };
    const spawnCalls = [];
    const manager = makeManager(root, {
      spawnFn: taskkillSpawn(spawnCalls),
      execFileFn: identityExec(processes),
    });
    manager.adoptedPid = 4321;
    manager.adoptedRecord = { pid: 4321, startedAtUnix: 1760000000, startSignature: null };
    manager.child = { exitCode: 0, signalCode: null, pid: 999 };

    const outcome = await manager.stop();
    assert.strictEqual(outcome.ok, false, "an unverified stop must not be reported as success");
    assert.strictEqual(outcome.verified, false);
    assert.strictEqual(spawnCalls.length, 0, "no kill may be attempted against a stranger");
    assert.match(outcome.reason, /没有停止后端/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stop() treats an already-exited adopted backend as a clean stop", async () => {
  const root = makeTempRoot("stop-gone");
  try {
    const spawnCalls = [];
    const manager = makeManager(root, {
      spawnFn: taskkillSpawn(spawnCalls),
      execFileFn: identityExec({}),
    });
    manager.adoptedPid = 4321;
    manager.adoptedRecord = { pid: 4321, startedAtUnix: 1760000000, startSignature: null };
    manager.child = { exitCode: 0, signalCode: null, pid: 999 };

    const outcome = await manager.stop();
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(spawnCalls.length, 0, "nothing to kill -> nothing spawned");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stop() does not trust a zero exit code from taskkill: surviving process = failure", async () => {
  const root = makeTempRoot("stop-survivor");
  try {
    // The process verifies as ours, taskkill claims success (exit 0), but the
    // process table says it is still there -> the stop is NOT confirmed.
    const processes = {
      4321: { startedAtUnix: 1760000000, commandLine: BACKEND_COMMAND },
    };
    const spawnCalls = [];
    const manager = makeManager(root, {
      spawnFn: taskkillSpawn(spawnCalls),
      execFileFn: identityExec(processes),
      exitConfirmTimeoutMs: 150,
      // 进程表说它还在：停止请求之后仍然存在 → 这次停止不算确认。
      processExistsFn: () => true,
    });
    manager.adoptedPid = 4321;
    manager.adoptedRecord = { pid: 4321, startedAtUnix: 1760000000, startSignature: null };
    manager.child = { exitCode: 0, signalCode: null, pid: 999 };

    const outcome = await manager.stop();
    assert.strictEqual(outcome.ok, false);
    assert.match(outcome.reason, /仍然存在/);
    assert.strictEqual(spawnCalls.length, 1, "the attempt itself was made");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readAdoptedRecord understands the macOS flat record file", () => {
  const root = makeTempRoot("adopted-macos");
  try {
    const manager = makeManager(root);
    fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "runtime", "backend.macos.pid"),
      "process_id=987\nstarted_at=2026-10-13T00:00:00Z\nstart_signature=Mon Oct 13 22:00:00 2026\n",
    );
    const record = manager.readAdoptedRecord();
    assert.ok(record, "the macOS record must be readable on any host");
    assert.strictEqual(record.pid, 987);
    assert.strictEqual(record.startSignature, "Mon Oct 13 22:00:00 2026");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stop() refuses to kill its own child when the pid was recycled (snapshot mismatch)", async () => {
  const root = makeTempRoot("stop-child-recycled");
  try {
    // The snapshot says "our backend"; the process table now answers with a
    // stranger on that pid. The handle says "alive", the evidence says "not
    // ours" -- the evidence wins and nothing is killed.
    const processes = { 4321: { startedAtUnix: 1760000000, commandLine: "C:\\Windows\\explorer.exe" } };
    const spawnCalls = [];
    const manager = makeManager(root, {
      spawnFn: taskkillSpawn(spawnCalls),
      execFileFn: identityExec(processes),
    });
    manager.child = { pid: 4321, exitCode: null, signalCode: null };
    manager.childIdentity = { pid: 4321, startedAtUnix: 1760000000, startSignature: null };

    const outcome = await manager.stop();
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(spawnCalls.length, 0, "a recycled pid must never be killed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recordSpawnedChild writes the launcher-format record for a directly spawned backend", async () => {
  const root = makeTempRoot("spawn-record");
  try {
    const processes = {
      1234: { startedAtUnix: 1760000000, commandLine: BACKEND_COMMAND },
    };
    const manager = makeManager(root, { execFileFn: identityExec(processes) });
    await manager.recordSpawnedChild(1234);

    const record = JSON.parse(fs.readFileSync(manager.adoptedPidFile(), "utf-8"));
    assert.strictEqual(record.process_id, 1234);
    assert.strictEqual(record.started_at_unix, 1760000000);
    assert.ok(record.started_at, "human-readable start time is kept for the launchers");
    // The record must round-trip through the same parser the launchers' readers use.
    const parsed = manager.readAdoptedRecord();
    assert.strictEqual(parsed.pid, 1234);
    assert.ok(manager.childIdentity, "the spawn identity snapshot is kept for stop()");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recordSpawnedChild skips the record when no start time can be read", async () => {
  const root = makeTempRoot("spawn-record-nostart");
  try {
    // A record without a verifiable start time is worse than none: it would
    // turn into an unverifiable kill target on the next launch.
    const processes = { 1234: { startedAtUnix: null, commandLine: BACKEND_COMMAND } };
    const manager = makeManager(root, { execFileFn: identityExec(processes) });
    await manager.recordSpawnedChild(1234);
    assert.strictEqual(fs.existsSync(manager.adoptedPidFile()), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stop() reports an unverified launcher handoff instead of a clean stop", async () => {
  // 启动器已退出、也没有可核验的记录：这时"没有句柄"不等于"没有后端"，
  // 不能报成功——否则主进程会放行更新安装，压在还活着的后端上（评审发现）。
  const root = makeTempRoot("stop-handoff-unverified");
  try {
    const manager = makeManager(root, { processExistsFn: () => false });
    manager.usingLauncher = true;
    manager.child = null;
    manager.adoptedPid = null;
    manager.adoptedRecord = null;

    const outcome = await manager.stop();
    assert.strictEqual(outcome.ok, false, "launcher handoff without a record must not pass");
    assert.strictEqual(outcome.verified, false);
    assert.match(outcome.reason, /启动器/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stop() treats a never-started backend as a clean no-op", async () => {
  const root = makeTempRoot("stop-never-started");
  try {
    const manager = makeManager(root, { processExistsFn: () => false });
    const outcome = await manager.stop();
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(manager.lastStop.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the shell's own record never clobbers another live backend's record", async () => {
  // 共享记录文件里已经有一条**别人的活后端**记录（控制台 start.cmd 起的）：
  // 桌面壳不该把它改写成自己的 pid，否则 stop.cmd 之后会对着死 pid 报"没在跑"。
  const root = makeTempRoot("record-foreign");
  try {
    const processes = {
      9001: { startedAtUnix: 1760000000, commandLine: BACKEND_COMMAND },
      1234: { startedAtUnix: 1760000001, commandLine: BACKEND_COMMAND },
    };
    const manager = makeManager(root, { execFileFn: identityExec(processes) });
    fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "runtime", "backend.json"),
      JSON.stringify({
        process_id: 9001,
        started_at_unix: 1760000000,
        started_at: "2026-10-13T00:00:00Z",
      }),
    );

    await manager.recordSpawnedChild(1234);
    const record = JSON.parse(fs.readFileSync(manager.adoptedPidFile(), "utf-8"));
    assert.strictEqual(record.process_id, 9001, "another live backend's record must survive");
    // 它仍然可以把自己记到内存里（stop 用得到），只是不抢文件。
    assert.strictEqual(manager.childIdentity.pid, 1234);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
