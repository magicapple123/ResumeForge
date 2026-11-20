// SPDX-License-Identifier: Apache-2.0
"use strict";

// 更新安装器命令的离线用例（2026-11-20，第 9.1 条）。
//
// 为什么单独一个文件：这段的命令构造从 updater.js 下沉到 lib/installer-command.js
// （updater.js 受 500 行预算），而它本身不 require("electron")，所以这里直接 require
// 就能断言，不需要 test-updater.js 那套 VM + electron 桩。
//
// 钉住的是两个实测过的约束：
//   1. **在安装器之前必须等主进程 pid 退出**：NSIS 静默安装会覆盖 exe，撞上仍被占用
//      的文件句柄就会静默失败（实测缺陷③）。
//   2. **`/S` 必须带 `--force-run`**（第 9.1 条，严重）：本项目是 assisted 安装器
//      （electron-builder.yml 的 `oneClick: false`），NSIS 模板只在
//      `${isForceRun} ${andIf} ${Silent}` 成立时才 doStartApp。只给 `/S` 的实测后果：
//      更新装完了，应用再也不出现——而确认框承诺过"会自动重新打开"。
//
// Run with: node --test scripts/test-installer-command.js

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { installerWaitCommand } = require("../lib/installer-command");

test("installerWaitCommand：脱离的 PowerShell 等 pid 退出后再跑静默安装", () => {
  const { file, args } = installerWaitCommand(
    "C:/Users/me/AppData/Local/Temp/ResumeForge-Setup-0.19.0.exe",
    4242,
  );
  assert.equal(file, "powershell");
  assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-WindowStyle", "Hidden", "-Command"]);
  assert.equal(args.length, 5, "命令整体只作为一个 -Command 参数传进去");

  const script = args[4];
  assert.match(script, /Wait-Process -Id 4242/, "必须先等（记录下来的）主进程 pid 退出");
  assert.match(script, /-ErrorAction SilentlyContinue/, "pid 恰好已退出时不能让脚本报错");
  assert.match(
    script,
    /Start-Process -FilePath 'C:\/Users\/me\/AppData\/Local\/Temp\/ResumeForge-Setup-0\.19\.0\.exe'/,
    "校验过的安装器路径要原样启动",
  );
});

test("installerWaitCommand：/S 与 --force-run 必须在同一个 ArgumentList 里", () => {
  const script = installerWaitCommand("C:/tmp/setup.exe", 1).args[4];
  assert.match(script, /-ArgumentList '\/S --force-run'/, "assisted 安装器只有 /S + --force-run 才会装完自动启动");
  // 分成两个 -ArgumentList 会被 PowerShell 当成两次启动（第二次没有 /S）。
  assert.equal(script.match(/-ArgumentList/g).length, 1, "只能有一个 ArgumentList");
  assert.equal(script.match(/Start-Process/g).length, 1, "只启动一次安装器");
});

test("installerWaitCommand：路径里的单引号要成对转义（否则命令被截断）", () => {
  const script = installerWaitCommand("C:/it's/setup.exe", 7).args[4];
  assert.match(script, /it''s/, "PowerShell 单引号字符串里的 ' 要写两遍");
  assert.equal(script.includes("it's"), false, "未转义的 ' 会把单引号字符串截断");
});

test("installerWaitCommand：pid 一律按数字写进命令（注入面收窄）", () => {
  const script = installerWaitCommand("C:/tmp/setup.exe", "42; Remove-Item C:/").args[4];
  assert.match(script, /Wait-Process -Id NaN/, "非数字 pid 变成 NaN（而不是拼进命令）");
  assert.equal(script.includes("Remove-Item"), false);
});
