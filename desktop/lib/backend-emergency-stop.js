// SPDX-License-Identifier: Apache-2.0
"use strict";

// 退出兜底（will-quit）：**同步**给"自己记录过的后端"发 SIGTERM。
//
// 为什么需要这一层：before-quit 里的停止是异步的（spawn taskkill / 等进程表 / 探测
// 端口 / 必要时反查监听者补杀），而且它的结论依赖 manager 里的状态（url、记录 pid）。
// 2026-11-23 的 2.3.1 门禁（run 45017991307）在 Linux 上抓到的是：显式退出请求之后
// 壳 177ms 就退了，uvicorn 还在 127.0.0.1:38223 上 accept。177ms 说明异步停止几乎
// 什么都没做——而"什么都没做"被当成"已经停了"。
//
// 异步那条路的两个洞已经分别补上（backend-stop.js 的 !manager.url 改成 UNKNOWN、
// backend-logs.js 开始读 Linux 的 backend.linux.pid），但**兜底不能依赖它判对**：
// 只要壳要退出，后端就必须跟着走。will-quit 是 Electron 给的最后一个同步点，
// 这里就是那一下。
//
// 四条纪律：
//   1. 同步：will-quit 里不能等 Promise（没有任何东西会为它停住事件循环），所以只有
//      `process.kill(pid, "SIGTERM")`，没有等待、没有端口探测。
//   2. 只打 manager 自己记录的 pid：不做"按端口反查再杀"（那是异步路径
//      lib/backend-listener-rescue.js 的职责，它需要进程表与身份校验）；记录为空
//      → 什么都不做，绝不猜。
//   3. 不许误杀：记录里的 pid 可能被回收成别人的进程，Linux 上同步读
//      /proc/<pid>/cmdline 复核一次（这是我们唯一能同步拿到的身份证据）；
//      自己 spawn 的 child 由句柄钉住，不需要这道复核。
//   4. 幂等：异步停止已确认成功时一个信号都不发；同一 pid 只发一次。
//
// killFn / platform / readCmdlineFn 都是注入点：desktop 的用例必须在**任何平台**上
// 离线跑，绝不能真的给某个 pid 发信号（backend-stop 的同名注入点因此存在，
// 这里是同一个理由）。

const fs = require("fs");

// 与 lib/backend-stop.js 的 BACKEND_COMMAND_PATTERNS 同一条特征（启动器用它复核
// "这个 pid 是不是我们的后端"：scripts/linux/lib/common.sh 的
// RF_BACKEND_COMMAND_PATTERN）。这里不复用那个常量：backend-stop 反过来不该依赖
// 这个模块，而两处都只是同一条正则在两个时机上用一次。
const BACKEND_COMMAND_PATTERN = /uvicorn\s+app\.main:app/;
const TERMINATE_SIGNAL = "SIGTERM";

/**
 * 读 Linux 的 /proc/<pid>/cmdline。返回 null = 读不到（进程已退出）。
 *
 * 为什么用 /proc 而不是 `ps`：will-quit 不能等子进程，而 /proc 是同步文件读。
 * NUL 分隔的参数用空格连起来，与 `ps -o args=` 的形状一致，同一条正则两处通用。
 *
 * @param {number} pid 目标进程号。
 * @returns {(string|null)} 命令行（读不到时为 null）。
 */
function readProcCmdline(pid) {
  try {
    return fs
      .readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replace(/\0/g, " ")
      .trim();
  } catch {
    return null;
  }
}

/**
 * 从 manager 自己的记录里取出"可能还活着的后端"。
 *
 * 优先 child（我们亲手 spawn 的，句柄钉住 pid），再取启动器交接来的记录。
 * child 与记录可能是同一个进程（直连模式会写记录），去重后各发一次。
 *
 * @param {object} manager BackendManager（或离线用例里的等价替身）。
 * @returns {Array<{pid: number, source: ("child"|"record")}>} 候选目标。
 */
function recordedTargets(manager) {
  const targets = [];
  const child = manager && manager.child;
  if (child && Number.isInteger(child.pid) && child.exitCode === null && child.signalCode === null) {
    targets.push({ pid: child.pid, source: "child" });
  }
  const record = manager && manager.adoptedRecord;
  const adoptedPid =
    record && Number.isInteger(record.pid)
      ? record.pid
      : manager && Number.isInteger(manager.adoptedPid)
        ? manager.adoptedPid
        : null;
  if (adoptedPid !== null && !targets.some((target) => target.pid === adoptedPid)) {
    targets.push({ pid: adoptedPid, source: "record" });
  }
  return targets;
}

/**
 * 异步停止没有确认成功时，同步给记录中的后端补一刀 SIGTERM。
 *
 * 绝不抛：will-quit 里抛出去只会盖掉真正的失败原因，而这一步本身是尽力而为。
 *
 * @param {object} manager BackendManager（或替身）。
 * @param {object} [options]
 * @param {boolean} [options.stopConfirmed] 异步停止是否已确认成功（true = 立即返回）。
 * @param {string} [options.platform] 平台注入点（默认 process.platform）。
 * @param {function(number, string): void} [options.killFn] 信号注入点
 *   （显式传入 > `manager.killFn` > 真实 process.kill，与 lib/backend-stop.js 同序）。
 * @param {function(number): (string|null)} [options.readCmdlineFn] 命令行读取注入点。
 * @param {number} [options.selfPid] 本进程 pid（默认 process.pid），永不发给自己。
 * @returns {{signaled: Array<{pid: number, signal: string, source: string}>,
 *   skipped: Array<{pid: (number|null), source: string, reason: string}>,
 *   log: string[]}} 结果与要写进 desktop-main.log 的若干行证据。
 */
function terminateRecordedBackend(manager, options = {}) {
  const {
    stopConfirmed = false,
    platform = process.platform,
    readCmdlineFn = readProcCmdline,
    selfPid = process.pid,
  } = options;
  const report = { signaled: [], skipped: [], log: [] };
  // 注入顺序与 lib/backend-stop.js::confirmTermination 一致：显式注入 > manager 的缝
  // > 真实信号。manager.killFn 在打包态是 null，用例里则是一个记录调用的替身。
  const killFn =
    options.killFn ??
    (manager && typeof manager.killFn === "function"
      ? (pid, signal) => manager.killFn(pid, signal)
      : (pid, signal) => process.kill(pid, signal));

  if (stopConfirmed) {
    report.log.push("quit fallback: 异步停止已确认，不发信号");
    return report;
  }

  const targets = recordedTargets(manager);
  if (targets.length === 0) {
    // 没有记录 = 不知道后端在哪，而不是"可以随便杀一个"。留一行是为了让下一次
    // 的 desktop-main.log 能自己说明"这次兜底为什么没动手"。
    report.log.push("quit fallback: 没有记录中的后端 pid，未发信号");
    return report;
  }

  for (const { pid, source } of targets) {
    if (!Number.isInteger(pid) || pid <= 1 || pid === selfPid) {
      const reason = "pid 不可用（<=1 或就是本进程）";
      report.skipped.push({ pid, source, reason });
      report.log.push(`quit fallback skipped: pid=${pid} source=${source} reason=${reason}`);
      continue;
    }
    // Linux 上记录里的 pid 必须当场复核命令行：will-quit 只差几十毫秒就退出，
    // 而"记录里的 pid 被回收成别人的进程"正是 RR-02 一直在防的那件事。
    if (source === "record" && platform === "linux") {
      const cmdline = readCmdlineFn(pid);
      if (cmdline === null) {
        const reason = "读不到 /proc 命令行（进程可能已退出）";
        report.skipped.push({ pid, source, reason });
        report.log.push(`quit fallback skipped: pid=${pid} source=${source} reason=${reason}`);
        continue;
      }
      if (!BACKEND_COMMAND_PATTERN.test(cmdline)) {
        const reason = "命令行不是后端（pid 已被复用）";
        report.skipped.push({ pid, source, reason });
        report.log.push(
          `quit fallback skipped: pid=${pid} source=${source} reason=${reason} command="${cmdline.slice(0, 120)}"`,
        );
        continue;
      }
    }
    try {
      killFn(pid, TERMINATE_SIGNAL);
      report.signaled.push({ pid, signal: TERMINATE_SIGNAL, source });
      report.log.push(`quit fallback: SIGTERM pid=${pid} source=${source}（异步停止未确认）`);
    } catch (err) {
      const reason = String((err && err.code) || err);
      report.skipped.push({ pid, source, reason });
      report.log.push(`quit fallback skipped: pid=${pid} source=${source} reason=${reason}`);
    }
  }
  return report;
}

module.exports = {
  BACKEND_COMMAND_PATTERN,
  TERMINATE_SIGNAL,
  readProcCmdline,
  recordedTargets,
  terminateRecordedBackend,
};
