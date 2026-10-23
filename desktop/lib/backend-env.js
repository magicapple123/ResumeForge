// SPDX-License-Identifier: Apache-2.0
"use strict";

// 后端子进程的环境变量构造 + 桌面壳日志目录的解析（行数预算的下沉，纯搬迁）。
//
// 这两块都只回答"后端需要知道哪几个路径"，本身不碰进程、不碰网络、不写文件：
// backend-manager.js 只保留调用，`buildBackendEnv` 仍从那里 re-export，既有
// 调用方与用例的 import 路径不变。
//
// 之所以单独成文件：`RF_DATA_DIR`（ADR-0004）与 `RF_DESKTOP_LOG_DIR`（诊断包
// 要带走桌面壳的两份日志）是同一件事的两半——都在描述"后端该往哪里落/读"，
// 与启动编排本身无关。

const path = require("path");

const { launcherStateEnv, resolveLogDir } = require("./shell-paths");

// --- ADR-0004: user data directory --------------------------------------------

// Build the extra environment for the backend process. The backend's config
// (backend/app/config.py) resolves its data directory from RF_DATA_DIR when
// set, so the database/attachments/exports follow the user profile instead of
// the install payload.
//
// RF_DESKTOP_LOG_DIR 把桌面壳那一份日志目录告诉后端：诊断包（/api/system/
// diagnostics/export）要能带上 desktop-main.log 与 desktop-backend.log，
// 否则"后端起不来"这类故障在包里只剩后端自己那份日志——而那一次恰好什么都
// 没写下来。目录仍由 lib/shell-paths.js 裁决（调用方传入）。
function buildBackendEnv(userDataDir, desktopLogDir = null) {
  const env = {};
  if (userDataDir) env.RF_DATA_DIR = userDataDir;
  if (desktopLogDir) env.RF_DESKTOP_LOG_DIR = desktopLogDir;
  return env;
}

// 桌面壳日志的真实落点（→ RF_DESKTOP_LOG_DIR）。与 openLog() 同一份裁决：
// openLog() 打开的日志文件在哪个目录，诊断包就点读哪个目录；日志没能打开时
// 再走一次 lib/shell-paths.js::resolveLogDir（绝不在这里另拼路径）。
function resolveDesktopLogDir({ logPath = null, runtimeDir = null } = {}) {
  if (logPath) return path.dirname(logPath);
  return resolveLogDir({ runtimeDir }).dir;
}

// 三条启动路径（打包运行时 / 兜底启动器 / 开发树 venv）共用的子进程 env。
//
// ADR-0004: bundled/launcher backends run against the user data dir.
// RF_DESKTOP_SHELL 让后端知道自己是"桌面形态"（而不是控制台/服务），用于行为与
// 诊断输出上的区分；RF_DESKTOP_LOG_DIR 见 buildBackendEnv 的注释（诊断包要带走
// 桌面壳的两份日志）。launcherStateEnv 只在 mac 打包态给出：把状态目录显式告诉
// start.sh，否则它和壳会各写一份 pid 记录，"退出后后端还在跑"。
//
// 覆盖顺序保持原样（后者覆盖前者）：baseEnv < 两个路径变量 < 桌面标记 < 状态目录。
function buildChildEnv({
  userDataDir = null,
  desktopLogDir = null,
  packaged = false,
  runtimeDir = null,
  baseEnv = process.env,
} = {}) {
  return {
    ...baseEnv,
    ...buildBackendEnv(userDataDir, desktopLogDir),
    ...(packaged ? { RF_DESKTOP_SHELL: "1" } : {}),
    ...launcherStateEnv({ packaged, runtimeDir }),
  };
}

module.exports = {
  buildBackendEnv,
  buildChildEnv,
  resolveDesktopLogDir,
};
