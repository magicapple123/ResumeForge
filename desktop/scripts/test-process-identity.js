// SPDX-License-Identifier: Apache-2.0
"use strict";

// Probes for desktop/lib/process-identity.js (RR-02).
//
// The identity readers never touch the real process table here: every probe
// injects a fake execFile that answers from a scripted table, so the suite is
// offline, deterministic, and can express "pid recycled", "process gone" and
// "identity unreadable" without killing anything.

const assert = require("assert");
const { test } = require("node:test");

const {
  PROBE_UNREADABLE,
  STATUS_GONE,
  STATUS_MISMATCH,
  STATUS_UNVERIFIABLE,
  STATUS_VERIFIED,
  commandMatches,
  parseProcessRecord,
  readProcessInfo,
  verifyProcessRecord,
  waitForProcessExit,
} = require("../lib/process-identity");

const BACKEND_PATTERNS = ["uvicorn\\s+app\\.main:app"];
// Same process shape both platforms must recognise.
const BACKEND_COMMAND = '"C:\\payload\\python\\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8010';

// A fake execFile driven by a scripted process table. `table[pid]` is either
// null (no such process) or { startedAtUnix, commandLine }.
function fakeExecFor(table, { platform = process.platform, failAll = false } = {}) {
  return async (file, args) => {
    if (failAll) return { code: 1, stdout: "", stderr: "boom" };
    const pidArg = platform === "win32" ? extractPidFromScript(args[args.length - 1]) : args[1];
    const pid = Number(pidArg);
    const entry = table[pid];
    if (!entry) {
      return platform === "win32"
        ? { code: 0, stdout: "null", stderr: "" }
        : { code: 1, stdout: "", stderr: "" };
    }
    if (platform === "win32") {
      return {
        code: 0,
        stdout: JSON.stringify({
          process_id: pid,
          started_at_unix: entry.startedAtUnix,
          command_line: entry.commandLine,
          executable_path: entry.executablePath || null,
        }),
        stderr: "",
      };
    }
    if (args.includes("lstart=")) {
      return { code: 0, stdout: `       ${entry.startSignature || "Mon Oct 13 22:00:00 2026"}\n` };
    }
    return { code: 0, stdout: `${entry.commandLine}\n` };
  };
}

function extractPidFromScript(script) {
  const match = /Get-Process -Id (\d+)/.exec(script);
  return match ? match[1] : "0";
}

// --- record parsing ------------------------------------------------------------

test("parseProcessRecord reads the Windows JSON record and the macOS flat record", () => {
  const win = parseProcessRecord(
    JSON.stringify({ process_id: 4321, started_at_unix: 1760000000, started_at: "2026-10-13T00:00:00Z" }),
  );
  assert.strictEqual(win.pid, 4321);
  assert.strictEqual(win.startedAtUnix, 1760000000);

  const mac = parseProcessRecord(
    [
      "process_id=987",
      "started_at=2026-10-13T00:00:00Z",
      "start_signature=Mon Oct 13 22:00:00 2026",
      "",
    ].join("\n"),
  );
  assert.strictEqual(mac.pid, 987);
  assert.strictEqual(mac.startedAtUnix, null);
  assert.strictEqual(mac.startSignature, "Mon Oct 13 22:00:00 2026");

  assert.strictEqual(parseProcessRecord(""), null, "an empty file has no record");
  assert.strictEqual(parseProcessRecord("{not json"), null);
  assert.strictEqual(parseProcessRecord("started_at=2026"), null, "no pid -> no record");
  assert.strictEqual(parseProcessRecord("process_id=0"), null, "pid 0 is never a target");
});

// --- command matching ----------------------------------------------------------

test("commandMatches uses the launcher patterns and rejects strangers", () => {
  assert.ok(commandMatches(BACKEND_COMMAND, BACKEND_PATTERNS));
  assert.ok(
    commandMatches("/payload/python/bin/python3 -m uvicorn app.main:app", BACKEND_PATTERNS),
    "the macOS launcher spelling must match too",
  );
  assert.ok(!commandMatches("C:\\Windows\\explorer.exe", BACKEND_PATTERNS));
  assert.ok(!commandMatches("", BACKEND_PATTERNS));
  assert.ok(!commandMatches(BACKEND_COMMAND, []), "no pattern -> nothing matches");
});

// --- verification --------------------------------------------------------------

test("verifyProcessRecord accepts a live backend whose start time matches", async () => {
  const table = { 4321: { startedAtUnix: 1760000000, commandLine: BACKEND_COMMAND } };
  const verdict = await verifyProcessRecord(
    { pid: 4321, startedAtUnix: 1760000000, startSignature: null },
    { commandPatterns: BACKEND_PATTERNS, execFileFn: fakeExecFor(table) },
  );
  assert.strictEqual(verdict.status, STATUS_VERIFIED);
});

test("verifyProcessRecord reports a recycled pid as a mismatch", async () => {
  // Same pid, but it now belongs to a completely different process started
  // hours later -- exactly the case that used to get taskkill'd.
  const table = { 4321: { startedAtUnix: 1760009999, commandLine: "C:\\Windows\\explorer.exe" } };
  const verdict = await verifyProcessRecord(
    { pid: 4321, startedAtUnix: 1760000000, startSignature: null },
    { commandPatterns: BACKEND_PATTERNS, execFileFn: fakeExecFor(table) },
  );
  assert.strictEqual(verdict.status, STATUS_MISMATCH);
  assert.match(verdict.reason, /命令行|复用/);
});

test("verifyProcessRecord reports a gone process separately from a mismatch", async () => {
  const verdict = await verifyProcessRecord(
    { pid: 4242, startedAtUnix: 1760000000, startSignature: null },
    { commandPatterns: BACKEND_PATTERNS, execFileFn: fakeExecFor({}) },
  );
  assert.strictEqual(verdict.status, STATUS_GONE);
});

test("verifyProcessRecord refuses to act when the identity cannot be read", async () => {
  // 探针本身跑不起来（EDR/策略/timeout）≠ 进程已消失：前者必须是"无法核验"，
  // 否则 stopped 会被当成"已经停了"，更新安装就会压在还在跑的后端上（评审发现）。
  const verdict = await verifyProcessRecord(
    { pid: 4321, startedAtUnix: 1760000000, startSignature: null },
    { commandPatterns: BACKEND_PATTERNS, execFileFn: fakeExecFor({}, { failAll: true }) },
  );
  assert.strictEqual(verdict.status, STATUS_UNVERIFIABLE, "读不到进程表只能报「无法核验」");
  assert.ok(verdict.status !== STATUS_VERIFIED, "unreadable evidence never authorises a kill");
  assert.ok(verdict.status !== STATUS_GONE, "不可读也不等于「已经退出」");

  // A readable process whose command line is empty (CIM unavailable) is
  // unverifiable, not a mismatch: refusing is the point.
  const emptyCommand = {
    4321: { startedAtUnix: 1760000000, commandLine: "" },
  };
  const verdict2 = await verifyProcessRecord(
    { pid: 4321, startedAtUnix: 1760000000, startSignature: null },
    { commandPatterns: BACKEND_PATTERNS, execFileFn: fakeExecFor(emptyCommand) },
  );
  assert.strictEqual(verdict2.status, STATUS_UNVERIFIABLE);
});

test("macOS start signatures keep the launcher's exact spacing", async () => {
  // mac 的 %e 把个位数日期补成两个空格：记录里就是 "Mon Nov  2 …"，读回来必须
  // 逐字一致（只去首尾空白），折叠内部空格会让每月 1–9 号都判成"不是我们的"。
  const table = {
    222: { commandLine: BACKEND_COMMAND, startSignature: "Mon Nov  2 22:00:00 2026" },
  };
  const info = await readProcessInfo(222, {
    platform: "darwin",
    execFileFn: fakeExecFor(table, { platform: "darwin" }),
  });
  assert.strictEqual(info.startSignature, "Mon Nov  2 22:00:00 2026");

  const verdict = await verifyProcessRecord(
    { pid: 222, startedAtUnix: null, startSignature: "Mon Nov  2 22:00:00 2026" },
    {
      commandPatterns: BACKEND_PATTERNS,
      platform: "darwin",
      execFileFn: fakeExecFor(table, { platform: "darwin" }),
    },
  );
  assert.strictEqual(verdict.status, STATUS_VERIFIED);

  const collapsed = await verifyProcessRecord(
    { pid: 222, startedAtUnix: null, startSignature: "Mon Nov 2 22:00:00 2026" },
    {
      commandPatterns: BACKEND_PATTERNS,
      platform: "darwin",
      execFileFn: fakeExecFor(table, { platform: "darwin" }),
    },
  );
  assert.strictEqual(collapsed.status, STATUS_MISMATCH, "签名不一致就该拒绝，不猜");
});

test("verifyProcessRecord refuses a pre-timestamp record even when the command line matches", async () => {
  const table = { 4321: { startedAtUnix: null, commandLine: BACKEND_COMMAND } };
  const verdict = await verifyProcessRecord(
    { pid: 4321, startedAtUnix: null, startSignature: null },
    { commandPatterns: BACKEND_PATTERNS, execFileFn: fakeExecFor(table) },
  );
  assert.strictEqual(verdict.status, STATUS_UNVERIFIABLE);
  assert.match(verdict.reason, /启动时刻/);
});

test("readProcessInfo separates gone / unreadable, and waitForProcessExit is fail-closed", async () => {
  const table = { 111: { startedAtUnix: 5, commandLine: BACKEND_COMMAND } };
  const info = await readProcessInfo(111, { execFileFn: fakeExecFor(table) });
  assert.ok(info, "a live pid yields identity data");
  assert.strictEqual(await readProcessInfo(222, { execFileFn: fakeExecFor(table) }), null);
  assert.strictEqual(
    await readProcessInfo(333, { execFileFn: fakeExecFor(table, { failAll: true }) }),
    PROBE_UNREADABLE,
    "a probe that cannot run is reported separately from a missing process",
  );

  // waitForProcessExit 用廉价的存在性探针（process.kill(pid, 0)）：这里用一个
  // 确定不存在的 pid 证明"已消失即返回 true"，用当前进程 pid 证明"还在就返回 false"。
  assert.strictEqual(await waitForProcessExit(0x7ffffffe, { timeoutMs: 200 }), true);

  const alive = await waitForProcessExit(process.pid, { timeoutMs: 150, intervalMs: 20 });
  assert.strictEqual(alive, false, "a live process never reports as exited");
});
