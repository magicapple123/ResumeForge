// SPDX-License-Identifier: Apache-2.0
"use strict";

// A1：根进程没了、端口还有人在听 —— 反查监听进程、校验身份、补杀**一次**，再探测。
//
// 2026-11-21 的两次应用内更新（12:34 / 12:37）都卡在这里，日志原文是
// 「根进程已退出，但后端端口仍可连接，无法确认后代进程已停止」＋ "第 1 次探测 open"。
// 2.3.0 的缓解只是"再多等 4.5 秒"（backend-stop.js 的 LISTENER_DRAIN_DELAYS_MS），
// 从来没有问过**谁**在听；那一次端口在退出之后还活了 37 秒
// （`releasing quit +37688ms`），而按"端口延迟释放"解释是错的 —— 受控实验里杀掉一个
// 临时服务 297ms 后探测就是 CLOSED。真的另有进程在 listen。
//
// 本模块只做"补杀这一步"的判定与副作用，探测/终止/时间线都由 backend-stop.js 通过
// `helpers` 注入（避免两个模块互相 require 的循环）。
//
// 仍然 blocked 的三种情况（**绝不**因为查不到就放行）：
//   1. 反查失败 / 超时 / 没有 pid；
//   2. 身份校验不是 STATUS_VERIFIED（命令行不匹配 = 别人的进程；缺启动时刻 = 无法确认）；
//   3. 补杀之后端口仍然可连接。

const processIdentity = require("./process-identity");
const { commandExcerpt, findPortListener } = require("./port-listener");

/**
 * 可以"在本机反查"的后端端口。
 *
 * 只有 loopback 地址才返回端口：非本机地址上"端口仍可连接"（probePortOnce 对非 loopback
 * 直接按 OPEN 处理）不代表本机有我们的后端，这时拿端口去本机进程表里找 listener 并补杀，
 * 有可能杀到一台无关的本地服务。返回 null 让调用方保持 blocked。
 */
function urlPort(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) return null;
    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

// 停止流程的诊断行不在这里发：`backend-manager.js` / `main.js` 都已经贴着 500 行预算，
// 没有位置再加一个 logger 注入点。所以本模块只**产出**那一行（返回值的 `log`），由
// quit-lifecycle 用既有的 logLine 写进 desktop-main.log —— 与
// `backend stop not verified (...)` 同一个出口、同一种格式。

/**
 * 这个 pid 我们已经掌握的身份证据（adopted 记录 / 自建子进程快照）。
 *
 * 监听进程恰好就是我们记录里的那个 pid 时，记录里的启动时刻是**更强**的证据：它在 pid
 * 可能被回收之前就写下了，而反查读到的时刻是几秒之前的现场。
 */
function recordedEvidenceFor(manager, pid) {
  for (const candidate of [manager.adoptedRecord, manager.childIdentity]) {
    if (candidate && candidate.pid === pid) {
      return {
        startedAtUnix: candidate.startedAtUnix || null,
        startSignature: candidate.startSignature || null,
      };
    }
  }
  return null;
}

/**
 * 补杀一个"根进程已退出、却仍占着后端端口"的监听进程。
 *
 * @param {object} manager 后端管理器（注入点与 stopBackend 相同）。
 * @param {number|null} port 后端端口。
 * @param {string} probeDetail 原始探测结论（拼进 detail 保留现场）。
 * @param {object} helpers backend-stop.js 注入的判定器，避免循环 require：
 *   `{ portStates, commandPatterns, confirmTermination, probeBackendPort, markQuitTimeline }`。
 * @returns {Promise<{state: string, reason: string, detail: string, log: string}>} state 是
 *   OPEN（仍 blocked）/ CLOSED（补杀成功且端口已关闭）/ UNKNOWN（补杀后探测无法收场）；
 *   `log` 是给 desktop-main.log 的那一行（空串 = 没什么可记）。
 */
async function rescueOrphanListener(manager, port, probeDetail, helpers) {
  const states = helpers.portStates;
  const blocked = (reason, detail, log) => ({ state: states.OPEN, reason, detail, log: log || "" });
  const describe = (lookup) =>
    `port=${port}; pid=${lookup.pid}; command="${commandExcerpt(lookup.commandLine) || "（读不到命令行）"}"`;
  if (!port) return blocked("后端地址不是本机 loopback（或没有端口），不在本机反查监听进程", probeDetail, "");

  const lookupFn =
    typeof manager.listenerLookupFn === "function"
      ? manager.listenerLookupFn
      : (target) => findPortListener(target, { platform: manager.platform, execFileFn: manager.execFileFn });
  let lookup;
  try {
    lookup = await lookupFn(port, manager);
  } catch (err) {
    return blocked(`反查端口 ${port} 的监听进程时出错：${err}`, probeDetail, "");
  }
  if (!lookup || !Number.isInteger(lookup.pid) || lookup.pid <= 0) {
    const why = (lookup && lookup.reason) || "反查没有返回可用的 pid";
    return blocked(
      `无法反查监听进程：${why}`,
      probeDetail,
      `backend stop rescue skipped (port=${port}; pid=未知; command="（未知）"; result=${why})`,
    );
  }

  if (typeof manager.verifyProcessFn !== "function") {
    // 没有身份校验器 = 无法确认它是不是我们的后端。这条路径必须保持 fail-closed：
    // 少一个注入绝不能退化成"看着像就杀"。
    return blocked(
      `反查到 pid=${lookup.pid}，但没有可用的身份校验器`,
      probeDetail,
      `backend stop rescue skipped (${describe(lookup)}; result=没有可用的身份校验器)`,
    );
  }

  const evidence = recordedEvidenceFor(manager, lookup.pid);
  const record = {
    pid: lookup.pid,
    startedAtUnix: (evidence && evidence.startedAtUnix) || lookup.startedAtUnix || null,
    startSignature: (evidence && evidence.startSignature) || lookup.startSignature || null,
  };
  const verdict = await manager.verifyProcessFn(record, {
    commandPatterns: helpers.commandPatterns,
    execFileFn: manager.execFileFn,
  });
  if (!verdict || verdict.status !== processIdentity.STATUS_VERIFIED) {
    const why = (verdict && verdict.reason) || "身份校验没有给出结论";
    return blocked(
      `反查到 pid=${lookup.pid}，但无法确认它是我们的后端：${why}`,
      probeDetail,
      `backend stop rescue skipped (${describe(lookup)}; result=身份校验未通过：${why})`,
    );
  }

  // 恰好一次补杀：复用 confirmTermination（Windows taskkill /T /F，POSIX
  // SIGTERM→SIGKILL），它自带"进程真的没了吗"的确认，失败即报失败。
  const killed = await helpers.confirmTermination(manager, lookup.pid, null);
  if (!killed.ok) {
    const why = killed.reason || "进程仍存在";
    return blocked(
      `已确认 pid=${lookup.pid} 是我们的后端，但补杀没有成功：${why}`,
      probeDetail,
      `backend stop rescue failed (${describe(lookup)}; result=${why})`,
    );
  }

  const reprobe = await helpers.probeBackendPort(manager, manager.portProbeFn);
  helpers.markQuitTimeline(manager, "listener rescue");
  const detail = `${describe(lookup)}; ${reprobe.detail}`;
  if (reprobe.state === states.CLOSED) {
    return {
      state: states.CLOSED,
      reason: "",
      detail,
      log: `backend stop rescued listener (${describe(lookup)}; result=已补杀，端口已关闭)`,
    };
  }
  const stuck = reprobe.state === states.OPEN;
  return {
    state: stuck ? states.OPEN : states.UNKNOWN,
    reason: `已补杀 pid=${lookup.pid}，但${stuck ? "端口仍可连接" : "探测无法确认端口已关闭"}`,
    detail,
    log: `backend stop rescue failed (${describe(lookup)}; result=已补杀但${
      stuck ? "端口仍可连接" : "端口探测无法收场"
    })`,
  };
}

module.exports = { rescueOrphanListener, urlPort };
