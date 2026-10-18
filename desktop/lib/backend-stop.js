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

const processIdentity = require("./process-identity");
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

// ~0/250/750ms: a backend that is really gone refuses the very first connect;
// the retries exist for a socket that is still unwinding after the kill.
const PORT_PROBE_DELAYS_MS = [0, 250, 750];
const PORT_PROBE_TIMEOUT_MS = 1000;

// errno values that mean "nothing is listening (any more)" rather than
// "we cannot tell". Kept as a Set so probePortOnce stays a pure lookup.
const PORT_CLOSED_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
]);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
        PORT_CLOSED_ERROR_CODES.has(code) ? PORT_STATE_CLOSED : PORT_STATE_UNKNOWN,
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
  if (!manager.url) return { state: PORT_STATE_CLOSED, detail: "后端地址未知（尚未启动）" };
  if (!attemptFn && manager.portOpenFn) {
    const open = await manager.portOpenFn(manager.url);
    return { state: open ? PORT_STATE_OPEN : PORT_STATE_CLOSED, detail: "测试注入 portOpenFn" };
  }
  let sawUnknown = false;
  let lastDetail = "";
  for (let attempt = 0; attempt < PORT_PROBE_DELAYS_MS.length; attempt += 1) {
    const delay = PORT_PROBE_DELAYS_MS[attempt];
    if (delay > 0) await sleep(delay);
    const attemptResult = attemptFn
      ? normalizeProbeResult(await attemptFn(manager, attempt))
      : await probePortOnce(manager.url);
    lastDetail = `第 ${attempt + 1} 次探测 "${attemptResult.state}"${
      attemptResult.detail ? `（${attemptResult.detail}）` : ""
    }`;
    if (attemptResult.state === PORT_STATE_OPEN) {
      return { state: PORT_STATE_OPEN, detail: lastDetail };
    }
    if (attemptResult.state !== PORT_STATE_CLOSED) sawUnknown = true;
  }
  // Every attempt refused the connection -> closed. Any attempt we could not
  // judge -> unknown (the caller warns instead of failing the quit).
  return { state: sawUnknown ? PORT_STATE_UNKNOWN : PORT_STATE_CLOSED, detail: lastDetail };
}

// What the backend's own command line looks like, mirrored from the launchers
// (Get-ResumeForgeProcessPattern in scripts/ResumeForge.Common.ps1 and
// RF_BACKEND_COMMAND_PATTERN in scripts/macos/start.sh). A recorded pid whose
// command line does not match this is never treated as ours.
const BACKEND_COMMAND_PATTERNS = ["uvicorn\\s+app\\.main:app"];

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
    if (probe.state === PORT_STATE_OPEN) {
      // Still reachable: fail closed, exactly as before (an update must not be
      // installed over a backend that is demonstrably alive).
      outcome = {
        ok: false,
        reason: "根进程已退出，但后端端口仍可连接，无法确认后代进程已停止",
        verified: false,
        detail: probe.detail,
      };
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
    const gone = await processIdentity.waitForProcessExit(pid, {
      timeoutMs: manager.exitConfirmTimeoutMs,
      existsFn: manager.processExistsFn,
    });
    if (gone) {
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
    timeoutMs: manager.exitConfirmTimeoutMs,
    existsFn: manager.processExistsFn,
  });
  if (gone) return { ok: true, reason: "", verified: true };
  if (!child) {
    // Adopted pid, still alive after SIGTERM: escalate once, then re-check.
    try {
      killFn(pid, "SIGKILL");
    } catch {
      // Raced with the exit.
    }
    const killed = await processIdentity.waitForProcessExit(pid, {
      timeoutMs: manager.exitConfirmTimeoutMs,
      existsFn: manager.processExistsFn,
    });
    if (killed) return { ok: true, reason: "", verified: true };
  }
  return { ok: false, reason: `进程 ${pid} 在停止请求后仍然存在`, verified: false };
}

module.exports = {
  BACKEND_COMMAND_PATTERNS,
  confirmTermination,
  probeBackendPort,
  stopAdoptedBackend,
  stopBackend,
  verifySpawnedChild,
};
