// SPDX-License-Identifier: Apache-2.0
"use strict";

// 判据失败时的自解释材料（lib/log-tail.js）。
//
// 现场（2026-11-23，run 45017991307）：Linux 四个矩阵的失败诊断包里只有截图，没有
// desktop-main.log，而最需要的两行就在那份日志里（`quit timing: …` 与
// `backend stop not verified …`）。这几条用例钉住三件事：
//   1. 找得到就打出尾部（行数上限真的生效，且是**最后** N 行）；
//   2. 找不到就打一行"缺失 + 找过的全部路径"——"日志缺失"本身也是结论；
//   3. 候选目录按平台推导，末尾永远带上壳的降级位置（临时目录）。
//
// Run with: node --test scripts/test-log-tail.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const { candidateLogDirs, formatLogTailReport, readLogTail } = require("../lib/log-tail");
const { makeTempRoot } = require("./testkit");

test("找到日志时打印最后 N 行（不是前 N 行）", () => {
  const root = makeTempRoot("log-tail-found");
  try {
    const dir = path.join(root, "logs");
    fs.mkdirSync(dir, { recursive: true });
    const lines = Array.from({ length: 45 }, (_, index) => `line-${index + 1}`);
    fs.writeFileSync(path.join(dir, "desktop-main.log"), `${lines.join("\n")}\n`);

    const report = readLogTail({ dirs: [dir] });
    assert.equal(report.found, true);
    assert.equal(report.lines.length, 40, "默认 40 行");
    assert.equal(report.lines[0], "line-6", "尾部 = 从第 6 行到第 45 行");
    assert.equal(report.lines[report.lines.length - 1], "line-45");

    const printed = formatLogTailReport(report);
    assert.match(printed[0], /desktop-main\.log 尾部 40 行/, "第一行要点名文件与行数");
    assert.ok(printed.slice(1).every((line) => line.startsWith("[log-tail] ")), "每行都带前缀，便于 grep");
    assert.match(printed[printed.length - 1], /line-45/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("日志缺失时打一行，带上找过的全部路径", () => {
  const root = makeTempRoot("log-tail-missing");
  try {
    const dirs = [path.join(root, "a", "logs"), path.join(root, "b", "logs")];
    const report = readLogTail({ dirs });
    assert.equal(report.found, false);
    assert.equal(report.path, null);

    const printed = formatLogTailReport(report);
    assert.equal(printed.length, 1, "缺失只占一行，不刷屏");
    assert.match(printed[0], /desktop-main\.log 缺失/);
    for (const dir of dirs) {
      assert.ok(printed[0].includes(path.join(dir, "desktop-main.log")), `要写明找过 ${dir}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("候选目录：按平台的 runtimeDir 推导，末尾永远是可写的降级位置", () => {
  const profile = "/prof";
  const tmpDir = "/tmp";
  assert.equal(
    candidateLogDirs({ platform: "linux", profile, tmpDir })[0],
    path.join(profile, ".local", "share", "ResumeForge", "runtime", "logs"),
    "Linux 的 runtimeDir 在 XDG 数据目录下（lib/shell-paths.js::linuxRuntimeDir）",
  );
  assert.equal(
    candidateLogDirs({ platform: "darwin", profile, tmpDir })[0],
    path.join(profile, "Library", "Application Support", "ResumeForge", "runtime", "logs"),
    "真实用户机器上 darwin 的 runtimeDir 在 userData 下，它必须仍是第一条",
  );
  assert.ok(
    candidateLogDirs({ platform: "darwin", profile, tmpDir }).includes(
      path.join(profile, "AppData", "Local", "runtime", "logs"),
    ),
    "冒烟给 darwin 也注入了 LOCALAPPDATA，壳因而按它取 runtimeDir；" +
      "少这一条会让 macOS 冒烟打出假的「日志缺失」",
  );
  assert.equal(
    candidateLogDirs({ platform: "win32", profile, tmpDir })[0],
    path.join(profile, "AppData", "Local", "ResumeForge", "runtime", "logs"),
    "Windows 的 runtimeDir 在 %LOCALAPPDATA% 下",
  );
  for (const platform of ["linux", "darwin", "win32"]) {
    const dirs = candidateLogDirs({ platform, profile, tmpDir });
    assert.equal(dirs[dirs.length - 1], path.join(tmpDir, "ResumeForge", "logs"),
      "安装目录只读时壳把日志降级到临时目录，那里也必须找一遍");
  }
  assert.deepStrictEqual(candidateLogDirs({ platform: "linux", profile: "", tmpDir }), [
    path.join(tmpDir, "ResumeForge", "logs"),
  ], "没有 profile 时只剩降级位置，绝不拼出半个路径");
});

test("darwin 冒烟：壳按注入的 LOCALAPPDATA 写日志，诊断必须找得到（不许报假缺失）", () => {
  const root = makeTempRoot("log-tail-darwin-smoke");
  try {
    const profile = path.join(root, "profile");
    // 冒烟给所有平台都设 LOCALAPPDATA = <profile>/AppData/Local；壳在 darwin 上取它。
    const smokeLogDir = path.join(profile, "AppData", "Local", "runtime", "logs");
    fs.mkdirSync(smokeLogDir, { recursive: true });
    fs.writeFileSync(
      path.join(smokeLogDir, "desktop-main.log"),
      "quit timing: stop requested at +0ms\nbackend stop not verified (launcherHandoffUnverified)\n",
    );

    const report = readLogTail({
      dirs: candidateLogDirs({ platform: "darwin", profile, tmpDir: path.join(root, "tmp") }),
    });
    assert.equal(report.found, true, "日志在 LOCALAPPDATA 下，诊断必须找到它");
    assert.equal(report.path, path.join(smokeLogDir, "desktop-main.log"));
    assert.equal(report.lines[report.lines.length - 1], "backend stop not verified (launcherHandoffUnverified)");
    // 那一行「缺失」曾经是冒烟的结论，它本身就是一个假 bug。
    const printed = formatLogTailReport(report);
    assert.doesNotMatch(printed[0], /缺失/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("读文件抛错只当“这条候选不存在”，继续找下一条", () => {
  const calls = [];
  // 用 path.join 拼期望值：Windows 上 "/first/logs" 会被重写成 "\first\logs"，
  // 拿字面量比较会让这条用例只在 Linux/macOS 上绿。
  const first = path.join("/first", "logs");
  const second = path.join("/second", "logs");
  const report = readLogTail({
    dirs: [first, second],
    readFileFn: (file) => {
      calls.push(file);
      if (file === path.join(first, "desktop-main.log")) throw new Error("ENOENT");
      return "quit timing: stop requested at +0ms\nbackend stop not verified\n";
    },
  });
  assert.deepStrictEqual(calls, [
    path.join(first, "desktop-main.log"),
    path.join(second, "desktop-main.log"),
  ]);
  assert.equal(report.found, true);
  assert.equal(report.path, path.join(second, "desktop-main.log"));
  assert.equal(report.lines.length, 2);
});
