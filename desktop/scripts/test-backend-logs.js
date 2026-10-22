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
  closeLogStream,
  openBackendLog,
  pidRecordDir,
  pidRecordPaths,
} = require("../lib/backend-logs");
const { makeTempRoot } = require("./testkit");

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
