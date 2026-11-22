// SPDX-License-Identifier: Apache-2.0
"use strict";

// 判据失败时的自解释材料：把**应用自己的日志尾部**交到 job 日志里。
//
// 为什么需要（2026-11-23，run 45017991307）：Linux 四个矩阵的失败诊断包里只有一张
// 截图，没有 desktop-main.log。而那次最想看的恰恰是里面的两行——
//   `quit timing: stop requested at +0ms …`
//   `backend stop not verified (...); url=…; detail=…`
// 它们直接说明"before-quit 的停止几乎没跑"，而截图只能说明"端口还通"。
//
// 三条纪律：
//   1. 只读两个固定文件名（desktop-main.log / desktop-backend.log），不递归目录：
//      runtime/logs 下还有轮转文件与其它产物，整目录扫会把无关内容带进 job 日志；
//   2. **找不到就打一行**（含找过的全部路径）——"日志缺失"本身也是结论：它说明壳连
//      日志都没写出来，而不是判据在瞎报；
//   3. 绝不抛：这是诊断设施，它失败不能把真正的失败原因盖掉（与 lib/diagnostic-summary.js
//      同一条纪律）。
//
// 路径推导刻意做成"候选列表 + 逐个尝试"，而不是 require 壳的模块：本文件被
// scripts/verify-packaged-startup.js 使用，那里只有 platform 与 profile 两个已知量
// （壳的 runtimeDir 由 main.js::runtimeDir 与 lib/shell-paths.js::linuxRuntimeDir 决定，
// 打包态下等价于这里的拼法），多列一条候选的代价是零，漏列一条的代价是又一轮"日志缺失"。
// 本文件不 require("electron")、也不需要联网。

const fs = require("fs");
const os = require("os");
const path = require("path");

/** 壳的运行日志（lib/preflight.js::MAIN_LOG_NAME 同名同义）。 */
const MAIN_LOG_NAME = "desktop-main.log";
/** 后端自己的 stdout/stderr 汇总（lib/backend-logs.js::BACKEND_LOG_NAME）。 */
const BACKEND_LOG_NAME = "desktop-backend.log";
/** 默认打印多少行尾部：够覆盖一次启动 + 一次退出的全部阶段标记。 */
const TAIL_LINES = 40;

/**
 * 候选日志目录，按优先级排列。
 *
 * 前几条对应壳的 runtimeDir（main.js::runtimeDir 的各个拼法）+ /logs；
 * 最后一条是日志目录不可写时壳的降级位置（lib/shell-paths.js::resolveLogDir 的
 * `<tmpDir>/ResumeForge/logs`）——装到只读挂载点上时，日志只会在那里。
 *
 * darwin 有两条，因为壳在 darwin 上的 runtimeDir 不是唯一形态：真实用户机器走
 * userData（`~/Library/Application Support/...`），而冒烟脚本注入 LOCALAPPDATA
 * 时壳会改按它取（见 darwin 分支里的注释）。
 *
 * @param {object} [options]
 * @param {string} [options.platform] "win32" | "darwin" | "linux"。
 * @param {string} [options.profile] 冒烟用的隔离 profile 目录（HOME / XDG_* 的根）。
 * @param {string} [options.tmpDir] 临时目录（默认 os.tmpdir()）。
 * @returns {string[]} 候选目录（profile 缺失时只有降级位置）。
 */
function candidateLogDirs({ platform = process.platform, profile, tmpDir = os.tmpdir() } = {}) {
  const dirs = [];
  if (profile) {
    if (platform === "linux") {
      // ${XDG_DATA_HOME:-$HOME/.local/share}/ResumeForge/runtime（lib/shell-paths.js）。
      dirs.push(path.join(profile, ".local", "share", "ResumeForge", "runtime", "logs"));
    } else if (platform === "darwin") {
      // 真实用户机器：main.js::runtimeDir 回落到 app.getPath("userData")
      // （= ~/Library/Application Support/ResumeForge）再拼 runtime。
      dirs.push(
        path.join(profile, "Library", "Application Support", "ResumeForge", "runtime", "logs"),
      );
      // 冒烟机器：scripts/verify-packaged-startup.js 给**所有平台**都设了
      // LOCALAPPDATA，而 main.js::runtimeDir 在 darwin 上取的是
      // `process.env.LOCALAPPDATA || app.getPath("userData")`——壳因此把日志写在
      // LOCALAPPDATA 下，且 darwin 分支不再拼 "ResumeForge"。少列这一条时诊断会
      // 报「desktop-main.log 缺失（壳可能连日志都没写出来）」，而日志就在隔壁，
      // 那是一个假结论，比没有结论更费时间。
      dirs.push(path.join(profile, "AppData", "Local", "runtime", "logs"));
    } else {
      // %LOCALAPPDATA%\ResumeForge\runtime（LOCALAPPDATA 由冒烟指到 profile 下）。
      dirs.push(path.join(profile, "AppData", "Local", "ResumeForge", "runtime", "logs"));
    }
  }
  dirs.push(path.join(tmpDir, "ResumeForge", "logs"));
  return dirs;
}

/**
 * 在候选目录里找到第一份存在的日志并取尾部若干行。
 *
 * 整文件读进来再切行（这几次冒烟里日志是几百 KB 级，`rotateLogFile` 也保证它不会
 * 无限长）；这里不做字节窗口，是为了让返回的"最后 N 行"真的是 N 行，而不是从
 * 半个 JSON 或半个时间戳开始。
 *
 * @param {object} [options]
 * @param {string[]} [options.dirs] 候选目录。
 * @param {string} [options.name] 日志文件名。
 * @param {number} [options.limit] 最多保留多少行（<=0 = 全部）。
 * @param {function(string, string): string} [options.readFileFn] 读文件注入点。
 * @returns {{found: boolean, path: (string|null), lines: string[], searched: string[]}}
 */
function readLogTail({
  dirs = [],
  name = MAIN_LOG_NAME,
  limit = TAIL_LINES,
  readFileFn = fs.readFileSync,
} = {}) {
  const searched = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const file = path.join(dir, name);
    if (searched.includes(file)) continue;
    searched.push(file);
    let text = null;
    try {
      text = String(readFileFn(file, "utf8"));
    } catch {
      // 不存在 / 不可读：试下一条候选。
      continue;
    }
    const lines = text.split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return { found: true, path: file, lines: limit > 0 ? lines.slice(-limit) : lines, searched };
  }
  return { found: false, path: null, lines: [], searched };
}

/**
 * 把一次 readLogTail 的结果变成要打出来的若干行（每行都带前缀，便于在 job 日志里 grep）。
 *
 * @param {{found: boolean, path: (string|null), lines: string[], searched: string[]}} result
 * @param {object} [options]
 * @param {string} [options.name] 日志文件名（只用于标题）。
 * @param {number} [options.limit] 行数上限（只用于标题）。
 * @returns {string[]} 要写到 stderr/stdout 的整行文本。
 */
function formatLogTailReport(result, { name = MAIN_LOG_NAME, limit = TAIL_LINES } = {}) {
  if (!result || !result.found) {
    const tried = (result && result.searched) || [];
    return [
      `[log-tail] ${name} 缺失（这是结论的一部分：壳可能连日志都没写出来）；找过：` +
        (tried.length > 0 ? tried.join(", ") : "（没有候选路径）"),
    ];
  }
  const header = `[log-tail] ${result.path} 尾部 ${result.lines.length} 行（上限 ${limit}）`;
  return [header, ...result.lines.map((line) => `[log-tail] ${line}`)];
}

module.exports = {
  BACKEND_LOG_NAME,
  MAIN_LOG_NAME,
  TAIL_LINES,
  candidateLogDirs,
  formatLogTailReport,
  readLogTail,
};
