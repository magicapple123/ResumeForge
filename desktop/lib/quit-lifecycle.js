// SPDX-License-Identifier: Apache-2.0
"use strict";

// Quit lifecycle for the desktop shell: requestInstallAndQuit / stopBackendSafely
// / spawnPendingInstaller / the before-quit body. Lifted out of main.js verbatim
// for the 500-line budget (audit A7) -- the file header of main.js already names
// this as one responsibility: "every exit path (tray exit, window close, update
// install, window-all-closed) funnels through app.quit() -> before-quit, which is
// the ONE place that stops the backend".
//
// main.js keeps the registration point (`app.on("before-quit", ...)`) and the
// `quitting` flag: the window close handler and the crash supervisor read that
// flag directly, so it stays a local there and is flipped through `setQuitting`.
//
// Three things are injected rather than required, on purpose:
//   * `app` / `dialog` -- this module must NOT `require("electron")`. The lifecycle
//     probes (scripts/lifecycle-harness.js) load main.js in a Node VM whose relative
//     requires go through the *real* Node loader, where `require("electron")` returns
//     the executable path string and every destructured member is `undefined`.
//   * `setTimeout` / `clearTimeout` -- the probes assert on the VM's captured timers
//     (6s plain-quit cap vs 15s install cap), so the shell's own timer functions are
//     handed down instead of the module's globals.
//   * `requireChildProcess` -- a lazy accessor, so the installer spawn keeps using
//     the shell's `child_process` (stubbed in the probes) and stays lazy as before.

// Hard cap on how long before-quit waits for the backend to stop. A normal
// quit is a user waiting in front of the tray menu, so the cap is short: a
// backend that is still there after 6s is reported in the log, not in a modal
// dialog (R3). The install path keeps the old, generous budget -- overwriting
// a live installation is the one case worth waiting (and failing) for.
const STOP_TIMEOUT_MS = 6_000;
const INSTALL_STOP_TIMEOUT_MS = 15_000;

/**
 * Builds the quit-lifecycle closure for the desktop shell.
 *
 * Everything that runs on a quit is created here; the returned functions are the
 * whole surface main.js needs.
 *
 * @param {object} deps Injected collaborators (no `require("electron")` in this file).
 * @param {object} deps.app Electron `app` module.
 * @param {object} deps.dialog Electron `dialog` module.
 * @param {function(string): void} deps.logLine Runtime log sink (user-profile log).
 * @param {function(): (object|null)} deps.getBackend Returns the current BackendManager.
 * @param {function(): any} deps.getRestartTimer Returns the pending crash-restart timer.
 * @param {function(boolean): void} deps.setQuitting Writes main.js' `quitting` flag.
 * @param {function(string, number): {file: string, args: string[]}} deps.installerWaitCommand
 *     Builds the detached "wait for this pid, then run the installer" command.
 * @param {function(): object} deps.requireChildProcess Lazy accessor for child_process.
 * @param {function(Function, number): any} deps.setTimeout Timer venue of the caller.
 * @param {function(any): void} deps.clearTimeout Timer venue of the caller.
 * @returns {{requestInstallAndQuit: function(string): void, handleBeforeQuit: function(object): void,
 *   getPendingInstallerPath: function(): (string|null), setPendingInstallerPath: function((string|null)): void}}
 *   The lifecycle surface; `handleBeforeQuit` is what `app.on("before-quit")` registers.
 */
function createQuitLifecycle(deps) {
  const {
    app,
    dialog,
    logLine,
    getBackend,
    getRestartTimer,
    setQuitting,
    installerWaitCommand,
    requireChildProcess,
    setTimeout: scheduleTimeout,
    clearTimeout: cancelTimeout,
  } = deps;

  // Set by the updater's installAndQuit dependency; the installer spawns in
  // before-quit AFTER the backend stop completes.
  //
  // Owned here and nowhere else: requestInstallAndQuit writes it, while both
  // readers (handleBeforeQuit's `installPending` decision and spawnPendingInstaller)
  // live in this same closure. main.js must not keep a second copy -- a double
  // write would make the `installPending` decision lie.
  let pendingInstallerPath = null;

  // before-quit state machine: quit is held while the backend stops, then
  // resumed exactly once.
  let stopInFlight = false;
  let shutdownComplete = false;

  /** @returns {(string|null)} The verified installer awaiting a spawn, if any. */
  function getPendingInstallerPath() {
    return pendingInstallerPath;
  }

  /** @param {(string|null)} value Path to spawn after the stop, or null to clear. */
  function setPendingInstallerPath(value) {
    pendingInstallerPath = value;
  }

  // Called by the updater once the installer checksum verified: quit first;
  // before-quit stops the backend and spawns the installer afterwards.
  function requestInstallAndQuit(installerPath) {
    // 更新是最容易"看起来什么都没发生"的路径：三个阶段都留痕（任务 12）。
    logLine(`install-start ${installerPath}`);
    setPendingInstallerPath(installerPath);
    app.quit();
  }

  // Stop the backend and normalise the outcome to { ok, reason }. The call
  // itself stays synchronous (the quit path must ask immediately); only the
  // result is awaited. A manager that reports nothing is treated as "completed"
  // (the pre-RR-02 contract) -- only an explicit ok:false blocks the install.
  function stopBackendSafely() {
    const backend = getBackend();
    if (!backend) return Promise.resolve({ ok: true, reason: "", verified: true });
    let started;
    try {
      started = backend.stop();
    } catch (err) {
      return Promise.resolve({ ok: false, reason: String(err), verified: false });
    }
    return Promise.resolve(started)
      .then((result) => (result && typeof result === "object" ? result : { ok: true, reason: "" }))
      .catch((err) => ({ ok: false, reason: String(err), verified: false }));
  }

  function spawnPendingInstaller() {
    if (!getPendingInstallerPath()) return;
    const installerPath = getPendingInstallerPath();
    setPendingInstallerPath(null);
    try {
      // NSIS 静默安装会覆盖 shell 的程序文件；在 Electron 还没退出、exe 句柄未
      // 释放时直接 spawn 会撞锁静默失败。改为派生一个**脱离的等待进程**：先等
      // 本主进程退出，再启动安装器（命令构造在 updater.installerWaitCommand，
      // 可离线单测）。后台停机已经在本函数被调用之前完成，顺序不变。
      const { file, args } = installerWaitCommand(installerPath, process.pid);
      const child = requireChildProcess().spawn(file, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      child.on("error", (err) => {
        logLine(`install-spawn-failed ${installerPath}: ${err}`);
        try { dialog.showErrorBox("简历通", "更新安装程序未能启动，请保留下载文件后手动重试。"); } catch {}
      });
      logLine(`install-spawned ${installerPath} (waits for shell pid ${process.pid})`);
    } catch (err) {
      logLine(`install-spawn-failed ${installerPath}: ${err}`);
    }
  }

  // The body of main.js' former `app.on("before-quit", (event) => { ... })`.
  function handleBeforeQuit(event) {
    // Second pass after the stop completed (and the installer, if any, was
    // spawned): let quit proceed.
    if (shutdownComplete) return;
    if (stopInFlight) {
      // Re-entrant quit request while the stop is already running.
      event.preventDefault();
      return;
    }
    event.preventDefault();
    setQuitting(true);
    stopInFlight = true;
    const restartTimer = getRestartTimer();
    if (restartTimer) cancelTimeout(restartTimer);
    // Hold quit until the backend tree is down; a dangling uvicorn would
    // keep file handles and break the next launch/update. The cap bounds
    // the wait even if the backend's own stop logic hangs.
    //
    // RR-02: "we asked it to stop" is not "it stopped". The stop outcome is
    // checked before the update installer is allowed to overwrite this
    // installation: an unverified stop (recycled pid, unreadable identity,
    // timeout) must never be papered over by an install.
    //
    // R3: a plain quit (tray exit, window close) must never block on a modal
    // dialog. Only a pending installer turns an unverified stop into an error
    // box -- that is the one path where continuing would corrupt an install.
    const installPending = Boolean(getPendingInstallerPath());
    const stopTimeoutMs = installPending ? INSTALL_STOP_TIMEOUT_MS : STOP_TIMEOUT_MS;
    const stopPromise = stopBackendSafely();
    const stopCapped = Promise.race([
      stopPromise,
      new Promise((resolve) => {
        scheduleTimeout(
          () => resolve({ ok: false, reason: "停止后端超时", verified: false, timedOut: true }),
          stopTimeoutMs,
        ).unref();
      }),
    ]);
    stopCapped.then((outcome) => {
      stopInFlight = false;
      shutdownComplete = true;
      const stopOk = Boolean(outcome && outcome.ok);
      const stopVerified = !outcome || outcome.verified !== false;
      const reason = (outcome && outcome.reason) || "未知原因";
      const backend = getBackend();
      const backendUrl = (backend && backend.url) || "（未知）";
      const probeDetail = (outcome && outcome.detail) || "（无）";
      if (stopOk && (!installPending || stopVerified)) {
        spawnPendingInstaller();
      } else if (installPending) {
        // The installer would overwrite files a live backend may still hold.
        setPendingInstallerPath(null);
        logLine(
          `backend stop not verified (${reason}); update install blocked; url=${backendUrl}; detail=${probeDetail}`,
        );
        try {
          dialog.showErrorBox(
            "简历通",
            `更新未安装：后端服务未被确认停止（${reason}）。\n` +
              "为避免覆盖仍在使用数据文件的后端进程，安装已取消。" +
              "请手动结束残留的后端进程后重试更新。",
          );
        } catch {
          // A failing dialog must not block the quit itself.
        }
      } else {
        // Ordinary quit: the user asked to leave, so leave. The evidence goes
        // to desktop-main.log for the next time someone asks "why is port 8010
        // still taken?" -- not into a dialog they cannot act on (R3).
        logLine(`backend stop not verified (${reason}); url=${backendUrl}; detail=${probeDetail}`);
        if (outcome && outcome.warning) {
          logLine(`backend stop warning: ${outcome.warning} (url=${backendUrl}; detail=${probeDetail})`);
        }
      }
      app.quit();
    });
  }

  return {
    requestInstallAndQuit,
    handleBeforeQuit,
    getPendingInstallerPath,
    setPendingInstallerPath,
  };
}

module.exports = { createQuitLifecycle };
