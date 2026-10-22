// SPDX-License-Identifier: Apache-2.0
"use strict";

// 运行期可写位置的唯一裁决点（故障诊断 P0）。
//
// 打包态的 install payload 位于程序目录内，一律按只读对待：mac 从 dmg 运行时
// 系统会把它放到 AppTranslocation（只读挂载），Windows 也可能装进只有管理员
// 可写的目录。往那里 mkdir/写日志就是 ENOENT / EPERM —— 原来的日志初始化没有
// 任何兜底，于是"日志写不进去"直接把桌面壳的启动打断
// （ENOENT ... payload/runtime/logs、EPERM ... resources\payload\runtime\logs）。
//
// 正确模型：程序目录只"被发现不可写"，不承担任何写入；运行期数据（日志、pid
// 记录）全部落在用户目录（%LOCALAPPDATA%\ResumeForge\runtime，mac 为 userData）。
//
// 本文件里的函数全部**绝不抛异常**：调用方基本都在启动主路径上，一个异常就
// 等于应用起不来。返回值只表达"能不能写、退到了哪里"。

const fs = require("fs");
const os = require("os");
const path = require("path");

const LOG_DIR_NAME = "logs";
// 探测文件名带 pid：多个实例同时探测时不会互相删掉对方刚建的文件。
const PROBE_PREFIX = ".rf-write-probe-";

// 真的写一个文件再删掉，而不是只看 fs.accessSync/stat：
// 目录存在且属主可读、但被只读挂载或 ACL 拒绝写入时，只有实际写才看得出来。
function probeWritable(dir, fsImpl = fs) {
  if (!dir) return false;
  const probePath = path.join(dir, `${PROBE_PREFIX}${process.pid}`);
  try {
    fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.writeFileSync(probePath, "ok");
    fsImpl.rmSync(probePath, { force: true });
    return true;
  } catch {
    // 只读挂载 / 权限不足 / 目录位置被一个普通文件占住：一律当"不可写"。
    // 顺手清掉可能写了一半的探测文件，失败也不重要。
    try {
      fsImpl.rmSync(probePath, { force: true });
    } catch {
      // 探测目录本身不可写，清理当然也会失败。
    }
    return false;
  }
}

// 日志目录的降级链：<runtimeDir>/logs（用户目录，首选）
//   -> <tmpDir>/ResumeForge/logs（系统临时目录，运行期一定可写）
//   -> 不写日志（仍然返回一个明确的 reason，供 UI 说明）。
// 返回值里的 degraded 表示"没有写到首选位置"，调用方据此决定要不要提示用户。
function resolveLogDir({ runtimeDir, tmpDir = os.tmpdir() } = {}) {
  const candidates = [];
  if (runtimeDir) candidates.push(path.join(runtimeDir, LOG_DIR_NAME));
  if (tmpDir) candidates.push(path.join(tmpDir, "ResumeForge", LOG_DIR_NAME));

  for (let index = 0; index < candidates.length; index += 1) {
    const dir = candidates[index];
    if (!probeWritable(dir)) continue;
    return {
      dir,
      degraded: index > 0,
      reason: index > 0 ? "安装目录不可写，日志已切换到系统临时目录" : "",
      candidates,
    };
  }

  return {
    dir: null,
    degraded: true,
    reason:
      candidates.length > 0
        ? "安装目录与系统临时目录都不可写，本次运行不保存日志"
        : "没有可用的日志目录（runtimeDir 与 tmpDir 均为空）",
    candidates,
  };
}

// 给主进程用的极简文件日志：目录**懒解析**（第一次真正写日志时才探测，
// 避免模块加载期就去碰文件系统），时间戳 + appendFileSync。
// 所有异常都吞掉 —— 日志写不进去不能反过来把壳带下去。
function createFileLogger(getLogDir, fileName = "desktop-main.log") {
  let cachedDir = null;
  return function log(message) {
    try {
      if (!cachedDir) cachedDir = getLogDir();
      if (!cachedDir) return;
      fs.mkdirSync(cachedDir, { recursive: true });
      fs.appendFileSync(
        path.join(cachedDir, fileName),
        `${new Date().toISOString()} ${message}\n`,
      );
    } catch {
      // 目录被删/被锁时丢掉缓存，下一行重新探测（也许已经切到可用位置）。
      cachedDir = null;
    }
  };
}

// 面向用户/错误信息的一句中文提示：有具体路径就给路径，降级就说明降级，
// 完全没有就直说"日志不可用"——绝不给一个写不进去的 payload 路径。
function logHint(logPath, degraded = false) {
  if (!logPath) return "日志不可用（安装目录与系统临时目录都不可写）";
  return degraded ? `${logPath}（系统临时目录：安装目录不可写）` : logPath;
}

// macOS 打包态要显式把"状态目录"告诉兜底启动器 start.sh（RF_STATE_DIR）：
// common.sh 的 rf_resolve_runtime_dir 算的是 "$RF_STATE_DIR/runtime"，注入
// path.dirname(runtimeDir) 之后，启动器算出的路径与壳的 runtimeDir() **恒等**
// ——两边的 pid 记录永远落在同一个目录里（否则表现是"退出应用后后端还在占端口"）
//
// 这是一条被钉死的约定，不是"纠正某条已知的错误路径"：壳的 runtimeDir() 与
// start.sh 的默认值本来就同层（都在 userData/productName 之下），注入只是让两边
// 不再各自依赖自己的默认值推导，避免哪天一处改了另一处没跟上。
//
// 只在 mac + 打包态注入：Windows 的启动器不读这个变量（另一套记录格式），
// 开发树则根本不走兜底启动器（payload 里带着 python-runtime.zip）。
function launcherStateEnv({ packaged, runtimeDir, platform = process.platform } = {}) {
  if (!packaged || platform !== "darwin" || !runtimeDir) return {};
  return { RF_STATE_DIR: path.dirname(runtimeDir) };
}

module.exports = {
  LOG_DIR_NAME,
  createFileLogger,
  launcherStateEnv,
  logHint,
  probeWritable,
  resolveLogDir,
};
