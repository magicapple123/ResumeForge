// SPDX-License-Identifier: Apache-2.0
"use strict";

// 后端日志句柄与 pid 记录（从 backend-manager.js 下沉，行数预算）。
//
// 这里只管"这些文件在哪、怎么写、怎么读"，不碰进程生命周期（spawn/kill 都在
// backend-manager.js 与 lib/backend-stop.js）。位置的唯一裁决点仍然是
// lib/shell-paths.js；本文件把裁决结果变成可用的句柄/候选路径/记录读写。
//
// 本文件的函数全部**绝不抛异常**：日志与 pid 记录都是诊断设施，写不进去不能
// 反过来把桌面壳的启动打断（诊断 P0）。

const fs = require("fs");
const path = require("path");
const processIdentity = require("./process-identity");
const { logHint: formatLogHint, resolveLogDir } = require("./shell-paths");
const { rotateLogFile } = require("./backend-runtime");

const BACKEND_LOG_NAME = "desktop-backend.log";
// 兜底启动器（Start-ResumeForge.ps1 / start.sh）在退出前记下真后端进程：
// Windows 写 JSON（backend.json），macOS 写扁平 key=value（backend.macos.pid），
// 同一份信息两种形状（scripts/macos/lib/common.sh），所以两种都要读（RR-02）。
const PID_RECORD_NAME = "backend.json";
const PID_RECORD_MACOS_NAME = "backend.macos.pid";

// 日志的**首选**路径：永远在用户目录的 runtimeDir 下，绝不指向安装 payload。
function backendLogFile(runtimeDir) {
  return path.join(runtimeDir, "logs", BACKEND_LOG_NAME);
}

// 打开日志流：runtimeDir -> 系统临时目录 -> 不写日志，逐级降级。
// 返回值恒为 { stream, path, degraded, reason, hint }，任何一步失败都只降级。
function openBackendLog({ runtimeDir, tmpDir, banner = "" } = {}) {
  const resolved = resolveLogDir({ runtimeDir, tmpDir });
  if (!resolved.dir) {
    // 一个可写目录都没有：不写日志，但仍然把原因留给调用方展示。
    return {
      stream: null,
      path: null,
      degraded: true,
      reason: resolved.reason || "日志目录不可写，本次运行不保存后端日志",
      hint: formatLogHint(null, true),
    };
  }
  const logPath = path.join(resolved.dir, BACKEND_LOG_NAME);
  try {
    // 日志按每次启动追加，先做体积轮转（lib/backend-runtime.js）。
    rotateLogFile(logPath);
    const stream = fs.createWriteStream(logPath, { flags: "a" });
    // 流上的异步错误（磁盘满、目录被删）只能吞掉：日志不能把壳带下去。
    stream.on("error", () => {});
    if (banner) stream.write(`\n==== ${banner} ====\n`);
    return {
      stream,
      path: logPath,
      degraded: resolved.degraded,
      reason: resolved.reason || "",
      hint: formatLogHint(logPath, resolved.degraded),
    };
  } catch {
    return {
      stream: null,
      path: null,
      degraded: true,
      reason: "日志目录不可写，本次运行不保存后端日志",
      hint: formatLogHint(null, true),
    };
  }
}

// 关闭日志句柄。日志 IO 绝不能把壳带下去（与主进程的 logLine 同一套纪律）：
// 文件被删/被锁时失败的 flush 在这里被吞掉。
function closeLogStream(stream) {
  if (!stream) return;
  stream.on("error", () => {});
  if (stream.pending) {
    // 还在打开中：destroy 取消这次 open。end() 会等这次 open 完成，与临时目录
    // 清理撞车（node --test 收尾时表现为 ENOENT）。
    stream.destroy();
    return;
  }
  stream.end();
}

// 运行期记录的写入根：打包态 = 用户目录 runtimeDir（安装目录只读）；开发树 =
// 仓库内 runtime/（start.cmd / stop.cmd 与既有用例都按这个位置找记录）。
function pidRecordDir({ packaged = false, projectRoot, runtimeDir } = {}) {
  return packaged ? runtimeDir : path.join(projectRoot, "runtime");
}

// pid 记录的候选位置，有序、去重（同一目录只出现一次）。
//
// 打包态只能写用户目录（runtimeDir），payload 下的 runtime/ 仅是旧版/兜底
// 启动器留下的**只读**位置，仍然读、绝不再写；开发树仍以仓库内 runtime/ 为准
// （start.cmd / stop.cmd 按这个位置找记录）。
function pidRecordPaths({
  packaged = false,
  projectRoot,
  runtimeDir,
  platform = process.platform,
} = {}) {
  const projectRuntime = projectRoot ? path.join(projectRoot, "runtime") : null;
  const primary = pidRecordDir({ packaged, projectRoot, runtimeDir });
  // 开发树只读仓库内 runtime/：用户目录那份属于安装版，开发壳不该认领它的后端。
  const dirs = packaged ? [primary, projectRuntime] : [primary];
  const names =
    platform === "darwin"
      ? [PID_RECORD_MACOS_NAME, PID_RECORD_NAME]
      : [PID_RECORD_NAME, PID_RECORD_MACOS_NAME];
  const paths = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      paths.push(candidate);
    }
  }
  return paths;
}

// 读第一份能解析出进程记录的候选文件。读它无害（只是"某个后端曾在跑"的证据，
// stop 前仍会核验身份），漏读却会让一次真实的后端变成"没找到、不敢停"。
function readFirstPidRecord(candidates, parse) {
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const record = parse(fs.readFileSync(candidate, "utf-8"));
      if (record) return record;
    } catch {
      // 记录缺失/不可读：试下一种形状。
    }
  }
  return null;
}

// The console launchers record the real backend process as
// {process_id, started_at_unix, started_at} (scripts/ResumeForge.Common.ps1);
// macOS writes the same fields flat plus start_signature
// (scripts/macos/lib/common.sh). Both shapes resolve to one record.
//
// 读取顺序 = 写入位置（pidDir）优先，再读 payload 下的历史位置：打包态的兜底
// 启动器 start.sh 仍会把记录写进 payload/runtime，旧安装也可能留着记录。
function readPidRecord(manager) {
  return readFirstPidRecord(pidRecordPaths(manager), processIdentity.parseProcessRecord);
}

// 把"壳自己 spawn 的后端"写成启动器用的同一份记录格式（RR-02：交接的两条腿
// 都要留下身份证据）。尽力而为：写不进去只是少一份诊断，绝不阻断启动。
function writePidRecord(recordPath, { pid, startedAtUnix }) {
  try {
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(
      recordPath,
      JSON.stringify({
        process_id: pid,
        started_at_unix: startedAtUnix,
        started_at: new Date(startedAtUnix * 1000).toISOString(),
        recorded_by: "desktop-shell",
      }),
    );
  } catch {
    // Recording is diagnostic; never block a launch on it.
  }
}

// Snapshot the identity of the backend the shell spawned and record it in the
// same format the console launcher uses (RR-02: identity is recorded on both
// legs of the handoff). Best effort: a record we cannot fill with a read start
// time is worse than no record, so it is skipped.
async function captureSpawnedChild(manager, pid) {
  const info = await processIdentity.readProcessInfo(pid, { execFileFn: manager.execFileFn });
  if (!info || typeof info !== "object") return;
  // The snapshot is ours regardless of what the shared record file says: it is
  // what stop() re-checks before killing this child.
  manager.childIdentity = info;
  // The record file is shared with the console launcher (start.cmd): if it
  // currently describes a DIFFERENT live backend, leave it alone -- the
  // desktop shell must not shadow a running console session's record, or
  // stop.cmd would later find a dead pid and report "not running".
  if (await manager.recordHoldsForeignLiveBackend(pid)) return;
  if (!Number.isInteger(info.startedAtUnix) || info.startedAtUnix <= 0) return;
  writePidRecord(manager.adoptedPidFile(), { pid, startedAtUnix: info.startedAtUnix });
}

// Adopt the backend that a launcher handed off (or that we spawned): the pid
// AND the evidence needed to re-verify it before any kill. Re-read on every
// health success so a crash-restart replaces the stale record instead of
// carrying the previous pid forward (RR-02).
function adoptRecordedBackend(manager) {
  const record = readPidRecord(manager);
  if (!record) return;
  manager.adoptedRecord = record;
  manager.adoptedPid = record.pid;
}

// 供壳（main.js）展示的降级说明；未降级返回空串。
function logDegradedNotice({ path: logPath = null, degraded = false, reason = "" } = {}) {
  if (!degraded) return "";
  return logPath
    ? `后端日志已改写到系统临时目录：${logPath}（安装目录不可写，属正常现象）`
    : `后端日志不可用：${reason}`;
}

module.exports = {
  BACKEND_LOG_NAME,
  PID_RECORD_MACOS_NAME,
  PID_RECORD_NAME,
  adoptRecordedBackend,
  backendLogFile,
  captureSpawnedChild,
  closeLogStream,
  logDegradedNotice,
  openBackendLog,
  pidRecordDir,
  pidRecordPaths,
  readFirstPidRecord,
  readPidRecord,
  writePidRecord,
};
