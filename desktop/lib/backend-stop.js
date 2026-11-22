// SPDX-License-Identifier: Apache-2.0
"use strict";

// Stopping the backend: verify identity, kill the tree, CONFIRM it is gone.
//
// Split out of backend-manager.js (line budget). The contract here is
// deliberately fail-closed (RR-02):
//
//   * a pid read from a record file is only an identity if it re-verifies
//     (process exists + command line matches + start time matches);
//   * a pid we spawned ourselves is re-checked against the identity snapshot
//     taken at spawn, so a recycled pid is never killed;
//   * "taskkill exited 0" is not proof -- the process table decides;
//   * the result is { ok, reason, verified } (+ optional `warning`/`detail`
//     from the three-state port probe, R3): the shell refuses to install an
//     update when ok is false, and refuses to install when `verified` is false
//     even though ok is true (an unreadable probe must not pass for "gone").
//
// Everything it needs from the manager (spawnFn / execFileFn / verifyProcessFn /
// exitConfirmTimeoutMs / the adopted record) is read off `manager`, so the
// manager keeps owning the lifecycle while this module owns the decisions.
//
// A1（2026-11-21）：探测到端口仍 OPEN 时不再只是"再等一会儿"——先反查监听进程
// （lib/port-listener.js），身份校验通过就补杀一次，然后再探测。判定与副作用在
// lib/backend-listener-rescue.js，这里只把探测/终止/时间线注入进去。

const processIdentity = require("./process-identity");
const { rescueOrphanListener, urlPort } = require("./backend-listener-rescue");
const net = require("net");

// Three-state port probe (R3). A single `connect` attempt used to answer a
// boolean question, and both "timed out" and "connection reset" were read as
// "still open". That is why a perfectly ordinary quit could end in
// "退出时未能确认后端服务已停止": the socket was still in TIME_WAIT-a-like
// state, the probe could not handshake, and the shell treated "cannot tell"
// as "definitely alive". The states are now explicit, so the caller can pick
// the right reaction: open -> fail closed, unknown -> pass with a warning.
const PORT_STATE_OPEN = "open";
const PORT_STATE_CLOSED = "closed";
const PORT_STATE_UNKNOWN = "unknown";
// 同一组状态交给 lib/backend-listener-rescue.js：状态名只在这里定义一次。
const PORT_STATES = { OPEN: PORT_STATE_OPEN, CLOSED: PORT_STATE_CLOSED, UNKNOWN: PORT_STATE_UNKNOWN };

// ~0/250/750ms: a backend that is really gone refuses the very first connect;
// the retries exist for a socket that is still unwinding after the kill.
const PORT_PROBE_DELAYS_MS = [0, 250, 750];
const LISTENER_DRAIN_DELAYS_MS = [500, 1000, 1500, 1500];
const PORT_PROBE_TIMEOUT_MS = 1000;

// Exit-confirmation cadence on the quit path (R3-B). taskkill has already been
// asked to kill the tree, so it is typically gone within a frame or two; a flat
// 300ms poll made every quit wait for a tick that had nothing left to observe.
// The first four polls run at 50ms, the long tail falls back to 300ms.
const EXIT_CONFIRM_POLL = { intervalMs: 300, fastIntervalMs: 50, fastAttempts: 4 };

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// 等待的注入点（默认真等）。连续 OPEN 时那条探测序列要真等 5.5 秒，而"仍然 blocked"
// 的用例关心的只是判定，不该为此变慢；生产里没有这一项，行为与之前逐字一致。
function pause(manager, ms) {
  const sleepFn = manager && manager.sleepFn;
  return typeof sleepFn === "function" ? sleepFn(ms) : sleep(ms);
}

// Quit timing (R3 acceptance evidence): lib/quit-lifecycle hands a recorder down
// through `manager.quitTimeline`, so each stop stage can stamp itself without
// this module owning a logger. Optional everywhere -- a manager without one
// (unit tests, a stop outside a quit) simply records nothing.
function markQuitTimeline(manager, label) {
  const timeline = manager && manager.quitTimeline;
  if (timeline && typeof timeline.mark === "function") timeline.mark(label);
}

// One probe attempt. Resolves to { state, detail } -- never rejects.
function probePortOnce(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return Promise.resolve({ state: PORT_STATE_UNKNOWN, detail: "后端地址无法解析" });
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port) {
    // Non-loopback or portless URL: the shell cannot probe it at all, so keep
    // the historical fail-closed reading ("still reachable") instead of
    // silently declaring the backend gone.
    return Promise.resolve({ state: PORT_STATE_OPEN, detail: "非本机地址，按仍可连接处理" });
  }
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port),
    });
    const finish = (state, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ state, detail });
    };
    socket.once("connect", () => finish(PORT_STATE_OPEN, "connect 成功"));
    socket.once("error", (error) => {
      const code = error && error.code;
      finish(
        code === "ECONNREFUSED" ? PORT_STATE_CLOSED : PORT_STATE_UNKNOWN,
        `error ${code || (error && error.message) || "unknown"}`,
      );
    });
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => finish(PORT_STATE_UNKNOWN, "探测超时"));
  });
}

function normalizeProbeResult(result) {
  if (typeof result === "string") return { state: result, detail: "" };
  if (result && typeof result.state === "string") {
    return { state: result.state, detail: String(result.detail || "") };
  }
  return { state: PORT_STATE_UNKNOWN, detail: "探测结果无法识别" };
}

// Is the backend port still answering? Returns { state, detail } where state is
// "open" | "closed" | "unknown".
//
// `attemptFn` is the injection point for tests (it receives the manager and the
// 0-based attempt index; it may answer with a state string or { state, detail }).
// `manager.portOpenFn` keeps its original boolean contract and is deliberately
// NOT retried: existing tests assert one probe per stop.
async function probeBackendPort(manager, attemptFn) {
  if (!manager.url) {
    // Fail-closed（2026-11-23）：没有地址 = **不知道**后端在哪，不是"已经没了"。
    // 这里以前返回 CLOSED，等于把"我不知道"读成"它停了"：stopBackend 的 `if (outcome.ok)`
    // 一拿到 CLOSED 就整条链路"确认已停"，before-quit 随即放行，壳 177ms 退出，而真
    // uvicorn 还活着（2.3.1 门禁 run 45017991307，Linux 四个矩阵全红）。
    // 三态里 UNKNOWN 早就存在，stopBackend 对它的处理也早就存在：退出不因此卡住，
    // 但这次停止**不算已核验**（安装更新会被拦住），并留下一行证据。
    return { state: PORT_STATE_UNKNOWN, detail: "后端地址未知（尚未启动或交接未记录），无法探测" };
  }
  if (!attemptFn && manager.portOpenFn) {
    const open = await manager.portOpenFn(manager.url);
    return { state: open ? PORT_STATE_OPEN : PORT_STATE_CLOSED, detail: "测试注入 portOpenFn" };
  }
  const delays = [...PORT_PROBE_DELAYS_MS];
  let refused = 0;
  let last = { state: PORT_STATE_UNKNOWN, detail: "" };
  for (const [attempt, delay] of delays.entries()) {
    if (delay > 0) await pause(manager, delay);
    const attemptResult = attemptFn
      ? normalizeProbeResult(await attemptFn(manager, attempt))
      : await probePortOnce(manager.url);
    const detail = `第 ${attempt + 1} 次探测 "${attemptResult.state}"${
      attemptResult.detail ? `（${attemptResult.detail}）` : ""
    }`;
    last = { state: attemptResult.state, detail };
    refused = last.state === PORT_STATE_CLOSED ? refused + 1 : 0;
    // Windows can accept one more connection just after taskkill reports the
    // root gone. Give the listener time to drain, then require two refusals.
    if (attempt < PORT_PROBE_DELAYS_MS.length - 1 && last.state === PORT_STATE_OPEN &&
        delays.length === PORT_PROBE_DELAYS_MS.length) {
      delays.push(...LISTENER_DRAIN_DELAYS_MS);
    }
    if (attempt >= PORT_PROBE_DELAYS_MS.length - 1 && refused >= 2) return last;
  }
  return last.state === PORT_STATE_OPEN ? last : { ...last, state: PORT_STATE_UNKNOWN };
}

// What the backend's own command line looks like, mirrored from the launchers
// (Get-ResumeForgeProcessPattern in scripts/ResumeForge.Common.ps1 and
// RF_BACKEND_COMMAND_PATTERN in scripts/macos/start.sh). A recorded pid whose
// command line does not match this is never treated as ours.
const BACKEND_COMMAND_PATTERNS = ["uvicorn\\s+app\\.main:app"];

// 探测到 OPEN 之后的补救步骤（A1）住在 lib/backend-listener-rescue.js：这里只把它
// 需要的判定器注入进去，两个模块因此不互相 require。

// A pid we spawned is ours by construction (the child handle pins it), but it
// is still re-checked against the identity snapshot taken at spawn before the
// tree is killed -- a pid recycled in the window between "the child died" and
// "we noticed" must not be killed. Returns null when the snapshot is missing
// or unreadable. A numeric PID without identity evidence must never be killed.
async function verifySpawnedChild(manager) {
  if (!manager.childIdentity || !Number.isInteger(manager.childIdentity.pid)) return null;
  return manager.verifyProcessFn(
    {
      pid: manager.childIdentity.pid,
      startedAtUnix: manager.childIdentity.startedAtUnix,
      startSignature: manager.childIdentity.startSignature,
    },
    { commandPatterns: BACKEND_COMMAND_PATTERNS, execFileFn: manager.execFileFn },
  );
}

// Stop the backend and report whether the target is confirmed gone.
// Resolves to { ok, reason, verified }.
async function stopBackend(manager) {
  const child = manager.child;
  // Launcher mode without a record is the one case where "no handle" does not
  // mean "no backend": the bootstrap script exits after handoff, so the real
  // uvicorn can be alive with nothing left to point at it. Report it as
  // unconfirmed instead of a clean stop -- the shell then refuses to install an
  // update over it (review finding: this branch used to pass silently).
  const launcherHandoffUnverified =
    manager.usingLauncher && !manager.adoptedRecord && !manager.adoptedPid;
  let outcome = launcherHandoffUnverified
    ? {
        ok: false,
        reason: "启动器已退出且没有可核验的进程记录，无法确认后端是否已停止",
        verified: false,
      }
    : { ok: true, reason: "没有正在运行的后端", verified: true };
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      // A child we spawned ourselves: the handle pins the pid, so this is our
      // process by construction. The identity snapshot taken at spawn still
      // gets the last word -- a pid recycled into someone else's process must
      // never be killed, handle or not.
      const verdict = await verifySpawnedChild(manager);
      if (!verdict || verdict.status === processIdentity.STATUS_MISMATCH || verdict.status === processIdentity.STATUS_UNVERIFIABLE) {
        outcome = {
          ok: false,
          reason: `没有停止后端：${verdict ? verdict.reason : "缺少进程身份快照"}（自建子进程 pid=${child.pid}）`,
          verified: false,
        };
      } else if (verdict && verdict.status === processIdentity.STATUS_GONE) {
        outcome = { ok: true, reason: "后端进程已退出", verified: true };
      } else {
        outcome = await confirmTermination(manager, child.pid, child);
      }
    } else if (manager.adoptedRecord || manager.adoptedPid) {
      outcome = await stopAdoptedBackend(manager);
    }
  } catch (err) {
    outcome = { ok: false, reason: `停止后端时出错：${err}`, verified: false };
  }
  if (outcome.ok) {
    // `manager.portProbeFn` mirrors the other injection seams on the manager
    // (spawnFn / killFn / processExistsFn / portOpenFn) so the three states can
    // be exercised without a real socket.
    const probe = await probeBackendPort(manager, manager.portProbeFn);
    markQuitTimeline(manager, "port probe");
    if (probe.state === PORT_STATE_OPEN) {
      // A1：端口还通不再等于"到此为止"。先问 OS 是谁在听：确认是我们的后端就补杀
      // 一次，再探测；查不到、不是我们的、补杀后还通，一律保持 blocked（fail-closed）。
      const rescue = await rescueOrphanListener(manager, urlPort(manager.url), probe.detail, {
        portStates: PORT_STATES,
        commandPatterns: BACKEND_COMMAND_PATTERNS,
        confirmTermination,
        probeBackendPort,
        markQuitTimeline,
      });
      if (rescue.state === PORT_STATE_CLOSED) {
        // 补杀成功：这一次的停止是有证据的（进程身份校验过 + 端口已关闭）。
        outcome = {
          ok: true,
          reason: "",
          verified: true,
          rescued: true,
          detail: rescue.detail,
          // 那一行证据由壳写进 desktop-main.log（quit-lifecycle 的 logLine）；
          // backend-manager.js / main.js 都贴着 500 行预算，不再加注入点。
          rescueLog: rescue.log,
        };
      } else if (rescue.state === PORT_STATE_UNKNOWN) {
        // 补杀后探测读不出结论：与普通 unknown 同一口径 —— 退出不为此卡住，
        // 但这次停止**不算已核验**，安装更新仍会被拦住。
        outcome = {
          ok: true,
          reason: "",
          verified: false,
          rescued: true,
          warning: "补杀后端口探测未能确认后端已停止",
          detail: rescue.detail,
          rescueLog: rescue.log,
        };
      } else {
        outcome = {
          ok: false,
          reason: `根进程已退出，但后端端口仍可连接，无法确认后代进程已停止${
            rescue.reason ? `（${rescue.reason}）` : ""
          }`,
          verified: false,
          detail: rescue.detail || probe.detail,
          rescueLog: rescue.log,
        };
      }
    } else if (probe.state === PORT_STATE_UNKNOWN) {
      // Cannot tell (timeout / unexpected errno). A quit must not be held
      // hostage by an unreadable socket, but the stop is NOT verified -- the
      // shell refuses to install an update on that.
      outcome = {
        ...outcome,
        verified: false,
        warning: "端口探测未能确认后端已停止",
        detail: probe.detail,
      };
    }
  }
  if (outcome.ok) manager.child = null;
  return outcome;
}

// The launcher already exited; the real backend runs on its own pid, read out
// of a record file. That pid is only an identity if it re-verifies -- a
// recycled pid means a stranger's process, which must never be killed.
async function stopAdoptedBackend(manager) {
  const record = manager.adoptedRecord || {
    pid: manager.adoptedPid,
    startedAtUnix: null,
    startSignature: null,
  };
  const verdict = await manager.verifyProcessFn(record, {
    commandPatterns: BACKEND_COMMAND_PATTERNS,
    execFileFn: manager.execFileFn,
  });
  if (verdict.status === processIdentity.STATUS_GONE) {
    return { ok: true, reason: "后端进程已退出", verified: true };
  }
  if (verdict.status !== processIdentity.STATUS_VERIFIED) {
    // Fail closed: leave the process alone and say why. The shell surfaces
    // this and blocks any update install afterwards.
    return {
      ok: false,
      reason: `没有停止后端：${verdict.reason}（记录 pid=${record.pid}）`,
      verified: false,
    };
  }
  return confirmTermination(manager, record.pid, null);
}

// Ask the platform to terminate the tree, then CONFIRM the process is gone
// before reporting success. taskkill's own exit code is NOT proof (it can
// report failure for an already-dead tree and success for a partially killed
// one) -- the process table is.
async function confirmTermination(manager, pid, child) {
  // posix kill 也走注入点：测试里的"假进程表"必须连信号一起拦下，否则在 macOS/
  // Linux 上跑测试会真的给 4321 发 SIGTERM/SIGKILL（评审发现）。
  const killFn = manager.killFn ?? ((target, signal) => process.kill(target, signal));
  if (process.platform === "win32") {
    const code = await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      try {
        const killer = manager.spawnFn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          windowsHide: true,
        });
        killer.on("exit", (exitCode) => done(exitCode));
        killer.on("error", () => done(null));
      } catch {
        done(null);
      }
      setTimeout(() => done(null), 8000).unref();
    });
    markQuitTimeline(manager, "taskkill exit");
    const gone = await processIdentity.waitForProcessExit(pid, {
      ...EXIT_CONFIRM_POLL,
      timeoutMs: manager.exitConfirmTimeoutMs,
      existsFn: manager.processExistsFn,
    });
    if (gone) {
      markQuitTimeline(manager, "process gone");
      return { ok: true, reason: "", verified: true };
    }
    return {
      ok: false,
      reason: `taskkill 后进程 ${pid} 仍然存在（退出码 ${code}）`,
      verified: false,
    };
  }

  if (child) {
    const exited = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.on("exit", () => resolve());
      setTimeout(resolve, 8000).unref();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    const terminate = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Raced with the exit.
        }
      }
    }, 5000);
    terminate.unref();
    await exited;
  } else {
    try {
      killFn(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  const gone = await processIdentity.waitForProcessExit(pid, {
    ...EXIT_CONFIRM_POLL,
    timeoutMs: manager.exitConfirmTimeoutMs,
    existsFn: manager.processExistsFn,
  });
  if (gone) {
    markQuitTimeline(manager, "process gone");
    return { ok: true, reason: "", verified: true };
  }
  if (!child) {
    // Adopted pid, still alive after SIGTERM: escalate once, then re-check.
    try {
      killFn(pid, "SIGKILL");
    } catch {
      // Raced with the exit.
    }
    const killed = await processIdentity.waitForProcessExit(pid, {
      ...EXIT_CONFIRM_POLL,
      timeoutMs: manager.exitConfirmTimeoutMs,
      existsFn: manager.processExistsFn,
    });
    if (killed) {
      markQuitTimeline(manager, "process gone");
      return { ok: true, reason: "", verified: true };
    }
  }
  return { ok: false, reason: `进程 ${pid} 在停止请求后仍然存在`, verified: false };
}

module.exports = {
  BACKEND_COMMAND_PATTERNS,
  confirmTermination,
  probeBackendPort,
  rescueOrphanListener,
  stopAdoptedBackend,
  stopBackend,
  verifySpawnedChild,
};
