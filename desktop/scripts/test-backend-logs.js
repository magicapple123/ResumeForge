// SPDX-License-Identifier: Apache-2.0
"use strict";

// lib/backend-logs.js 的契约（从 backend-manager.js 下沉出来的那一层）。
//
// 这里固化的三件事，都是"下沉"时最容易走样的：
//   1. pid 记录的候选位置：顺序（先写后读）、去重、平台决定文件形状的先后；
//   2. 日志句柄：一个可写目录都没有时也只返回降级结果，绝不抛；
//   3. 关闭句柄：pending 走 destroy（end() 会与临时目录清理撞车），否则 end()。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const {
  PID_RECORD_LINUX_NAME,
  closeLogStream,
  openBackendLog,
  pidRecordDir,
  pidRecordPaths,
  readPidRecord,
} = require("../lib/backend-logs");
const { makeTempRoot } = require("./testkit");

// 仓库根：本文件在 desktop/scripts/ 下，shell 侧的启动脚本在根 scripts/ 下。
const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("pidRecordDir：打包态写用户目录，开发树写仓库内 runtime/", () => {
  const opts = { packaged: true, projectRoot: "/repo", runtimeDir: "/user/ResumeForge/runtime" };
  assert.strictEqual(pidRecordDir(opts), "/user/ResumeForge/runtime");
  assert.strictEqual(
    pidRecordDir({ ...opts, packaged: false }),
    path.join("/repo", "runtime"),
    "start.cmd / stop.cmd 仍按仓库内 runtime/ 找记录",
  );
});

test("pidRecordPaths：写入位置优先、包含 payload 回退、同一目录只出现一次", () => {
  const projectRoot = "/repo";
  const runtimeDir = "/user/ResumeForge/runtime";

  const packaged = pidRecordPaths({ packaged: true, projectRoot, runtimeDir, platform: "win32" });
  assert.deepStrictEqual(packaged, [
    path.join(runtimeDir, "backend.json"),
    path.join(runtimeDir, "backend.macos.pid"),
    path.join(projectRoot, "runtime", "backend.json"),
    path.join(projectRoot, "runtime", "backend.macos.pid"),
  ], "打包态：用户目录优先，payload 下的历史位置兜底");

  // macOS 写的是扁平 key=value 记录：先读那一种形状。
  const darwin = pidRecordPaths({ packaged: true, projectRoot, runtimeDir, platform: "darwin" });
  assert.deepStrictEqual(darwin.slice(0, 2), [
    path.join(runtimeDir, "backend.macos.pid"),
    path.join(runtimeDir, "backend.json"),
  ]);

  const dev = pidRecordPaths({ packaged: false, projectRoot, runtimeDir, platform: "win32" });
  assert.deepStrictEqual(dev, [
    path.join(projectRoot, "runtime", "backend.json"),
    path.join(projectRoot, "runtime", "backend.macos.pid"),
  ], "开发树两个位置重合，只读一遍");
});

test("openBackendLog：只返回降级结果，绝不抛（一个可写目录都没有）", () => {
  const root = makeTempRoot("backend-logs-blocked");
  try {
    // 普通文件当目录用：mkdir 在任何平台都失败，等价于"安装目录只读"。
    const blocker = path.join(root, "blocked");
    fs.writeFileSync(blocker, "not a directory");

    const opened = openBackendLog({
      runtimeDir: path.join(blocker, "runtime"),
      tmpDir: path.join(blocker, "tmp"),
      banner: "should not throw",
    });
    assert.strictEqual(opened.stream, null);
    assert.strictEqual(opened.path, null);
    assert.strictEqual(opened.degraded, true);
    assert.match(opened.reason, /不可写/);
    assert.match(opened.hint, /不可用/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("openBackendLog：可写时给出真实路径、非降级，并写下本次启动横幅", async () => {
  const root = makeTempRoot("backend-logs-ok");
  try {
    const runtimeDir = path.join(root, "runtime");
    const opened = openBackendLog({ runtimeDir, banner: "desktop launch test" });
    assert.strictEqual(opened.degraded, false);
    assert.strictEqual(opened.path, path.join(runtimeDir, "logs", "desktop-backend.log"));
    assert.strictEqual(opened.hint, opened.path, "未降级的提示就是路径本身");

    // createWriteStream 是异步打开 + 缓冲写：等待它真的落盘再断言，否则读到空。
    const deadline = Date.now() + 2000;
    let text = "";
    while (Date.now() < deadline && !text.includes("desktop launch test")) {
      try {
        text = fs.readFileSync(opened.path, "utf-8");
      } catch {
        // 文件还没创建出来，继续等。
      }
      if (!text.includes("desktop launch test")) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    assert.match(text, /==== desktop launch test ====/);
    closeLogStream(opened.stream);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pidRecordPaths：Linux 读启动器写的 backend.linux.pid（2.3.1 门禁 run 45017991307）", () => {
  // Linux 的兜底启动器把真后端记在 runtime/backend.linux.pid（key=value，
  // scripts/linux/start.sh:206 + common.sh:471）。漏读它的后果不是"少一份诊断"：
  // 打包态 Linux 的 payload 按设计不带 python-runtime.zip，永远走兜底启动器，
  // 交接完成后 adoptRecordedBackend() 什么也没读到，退出时 stopBackend 落进
  // "launcherHandoffUnverified"——一个字都没杀，壳 177ms 就退了，uvicorn 还占着端口。
  const projectRoot = "/repo";
  const runtimeDir = "/user/ResumeForge/runtime";
  const linux = pidRecordPaths({ packaged: true, projectRoot, runtimeDir, platform: "linux" });
  assert.deepStrictEqual(linux, [
    path.join(runtimeDir, "backend.linux.pid"),
    path.join(runtimeDir, "backend.json"),
    path.join(runtimeDir, "backend.macos.pid"),
    path.join(projectRoot, "runtime", "backend.linux.pid"),
    path.join(projectRoot, "runtime", "backend.json"),
    path.join(projectRoot, "runtime", "backend.macos.pid"),
  ], "Linux 自己的记录优先，另外两种形状作为历史兜底");
  // 别的平台不许多出这一条：Windows 上 `backend.linux.pid` 只可能是一份残留。
  const win = pidRecordPaths({ packaged: true, projectRoot, runtimeDir, platform: "win32" });
  assert.ok(!win.some((candidate) => candidate.endsWith("backend.linux.pid")));
});

test("交叉守卫：启动器写的记录名与壳读的记录名必须同一个（backend.linux.pid）", () => {
  // 为什么需要（2026-11-23 复核）：这个名字在两侧各有实现——shell 侧是
  // scripts/linux/start.sh 的 `RF_BACKEND_RECORD=…`，壳侧是 lib/backend-logs.js 的
  // PID_RECORD_LINUX_NAME。scripts/tests/test-linux-launcher.sh 只钉住"start.sh 里
  // 出现一次"，壳自己的用例只钉住"候选列表里有这个名字"，两边各自绿着、对不上时
  // 却没人红。本次故障（壳按 launcherHandoffUnverified 一个字都没杀）正是这个形态，
  // 所以这里把两侧**比一次**。
  const startShPath = path.join(REPO_ROOT, "scripts", "linux", "start.sh");
  // 读不到就让它抛：这条守卫的全部价值就是"两侧真的比过"，静默跳过等于放回生产。
  const text = fs.readFileSync(startShPath, "utf8");

  // 只认赋值那一行（`RF_BACKEND_RECORD=` 出现在 5 处，只有一处是赋值）。
  const assignment = /^RF_BACKEND_RECORD=(.*)$/m.exec(text);
  assert.ok(
    assignment,
    `${startShPath} 里找不到 RF_BACKEND_RECORD= 赋值；壳靠它定位启动器写的记录，` +
      `这一行消失就等于交接失效`,
  );
  const value = assignment[1].trim().replace(/^["']|["']$/g, "");
  assert.ok(
    value.endsWith(`/${PID_RECORD_LINUX_NAME}`),
    `记录名两侧不一致：start.sh 写的是 RF_BACKEND_RECORD=${value}，` +
      `而 lib/backend-logs.js 的 PID_RECORD_LINUX_NAME=${PID_RECORD_LINUX_NAME}` +
      `（壳读不到启动器的记录时，退出不会停后端，只剩一个占着端口的孤儿进程）`,
  );
});

test("readPidRecord：Linux 的扁平记录能解析出 pid 与启动签名", () => {
  const root = makeTempRoot("pid-record-linux");
  try {
    const runtimeDir = path.join(root, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    // 逐字照抄 save_process_record（scripts/linux/lib/common.sh:471）的三个字段。
    fs.writeFileSync(
      path.join(runtimeDir, "backend.linux.pid"),
      "process_id=4321\nstarted_at=2026-11-23T10:57:52Z\nstart_signature=Mon Nov 23 10:57:52 2026\n",
    );
    const record = readPidRecord({
      packaged: true,
      projectRoot: root,
      runtimeDir,
      platform: "linux",
    });
    assert.ok(record, "Linux 的记录必须能读出来，否则交接后的后端无人可停");
    assert.strictEqual(record.pid, 4321);
    // POSIX 的身份证据是 lstart 的原始字符串（process-identity 的读取顺序：先
    // started_at_unix，没有才对签名）——Linux 那份记录只有签名。
    assert.strictEqual(record.startSignature, "Mon Nov 23 10:57:52 2026");
    assert.strictEqual(record.startedAtUnix, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("closeLogStream：pending 用 destroy，正常句柄用 end，都吞掉错误", () => {
  const calls = [];
  const fake = (pending) => ({
    pending,
    on: (event) => calls.push(`on:${event}`),
    destroy: () => calls.push("destroy"),
    end: () => calls.push("end"),
  });

  closeLogStream(fake(true));
  assert.deepStrictEqual(calls, ["on:error", "destroy"], "还在打开中：不能等 open 完成");
  calls.length = 0;
  closeLogStream(fake(false));
  assert.deepStrictEqual(calls, ["on:error", "end"]);
  calls.length = 0;
  assert.doesNotThrow(() => closeLogStream(null));
  assert.deepStrictEqual(calls, []);
});
