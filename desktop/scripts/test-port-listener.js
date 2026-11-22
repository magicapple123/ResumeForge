// SPDX-License-Identifier: Apache-2.0
"use strict";

// 「谁在监听这个端口」反查本身（A1 的底层，lib/port-listener.js）。
//
// 语义用例（补杀 / 不杀）在 scripts/test-stop-failclosed.js 里；这里只钉反查这一层：
//
//   1. 两个 Windows 解析器（netstat / Get-NetTCPConnection）都要能出 pid ——
//      端口必须精确匹配（151152 不能算 51152），只认 LISTENING 行；
//   2. Linux `ss` 的 users:(("…",pid=…)) 与 macOS `lsof -t` 的一行一个 pid；
//   3. 真的起一个 socket，反查要能问出**持有它的那个进程**（工具缺失时 skip 并打印原因）。
//
// 第 3 条是这一层唯一能发现"命令拼错 / 输出格式改了"的用例：注入替身永远发现不了。
//
// Run with: node --test scripts/test-port-listener.js

const assert = require("node:assert/strict");
const net = require("node:net");
const { test } = require("node:test");
const {
  findPortListener,
  parseLsofPids,
  parseNetstatListener,
  parseSsListener,
} = require("../lib/port-listener");

test("反查解析：netstat -ano 只认端口精确匹配的 LISTENING 行", () => {
  const text = [
    "",
    "活动连接",
    "",
    "  协议  本地地址          外部地址        状态           PID",
    "  TCP    127.0.0.1:151152     0.0.0.0:0              LISTENING       9999",
    "  TCP    127.0.0.1:51152      0.0.0.0:0              LISTENING       4321",
    "  TCP    127.0.0.1:51152      127.0.0.1:5123         ESTABLISHED     4321",
    "",
  ].join("\r\n");
  assert.equal(parseNetstatListener(text, 51152), 4321, "151152 不能被当成 51152");
  assert.equal(parseNetstatListener(text, 5115), null, "只有前缀相同不算");
  assert.equal(parseNetstatListener("", 51152), null, "空输出 = 查不到，不是崩溃");
});

test("反查解析：ss 的 users:(...) 里取 pid，lsof -t 一行一个 pid", () => {
  const ss = [
    "State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process",
    'LISTEN 0      2048   127.0.0.1:511520    0.0.0.0:*         users:(("other",pid=1111,fd=3))',
    'LISTEN 0      2048   127.0.0.1:51152     0.0.0.0:*         users:(("python.exe",pid=6512,fd=7))',
    'LISTEN 0      2048   [::]:51152          [::]:*            users:(("python.exe",pid=6512,fd=9))',
  ].join("\n");
  // 与 scripts/linux/lib/common.sh 同一套判据：只比本地地址列的尾部，
  // 所以 :511520 不会被误判成 51152，而 [::]:51152 会命中。
  assert.equal(parseSsListener(ss, 51152), 6512);
  assert.equal(parseSsListener(ss, 5115), null, "只有前缀相同不算");
  assert.equal(parseSsListener("LISTEN 0 2048 127.0.0.1:51152 0.0.0.0:*"), null, "没有 pid= 就是查不到");
  assert.equal(parseLsofPids("4321\n"), 4321);
  assert.equal(parseLsofPids(""), null);
});

test("反查真的能问出监听进程的 pid（工具缺失时 skip 并说明原因）", async (t) => {
  // 监听它的是本进程，所以答案必须是 process.pid。
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const found = await findPortListener(port);
    if (!found.pid) {
      // 没有 ss / lsof / netstat 的镜像（精简容器）不算失败：明确 skip 并打印原因，
      // 让"跳过数"可以被数出来，而不是悄悄放过。
      t.skip(`本机没有可用的反查工具：${found.reason}`);
      return;
    }
    assert.equal(found.pid, process.pid, `反查到的应当是持有 socket 的本进程（实际 ${JSON.stringify(found)}）`);
    assert.match(String(found.commandLine), /node/i, "身份证据里的命令行要能读出来");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
