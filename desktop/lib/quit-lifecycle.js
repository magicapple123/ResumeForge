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
// The `will-quit` fallback is the one exception -- it registers itself below,
// because it only reads state owned by this closure (see handleWillQuit).
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
//   * `getWindow` -- the main window handle (R3-A hides it before the stop). Same
//     reason as `app`/`dialog`: this module must stay electron-free.
//
// 用户可见的两条错误框文案跟随应用内语言（lib/shell-locale.js）；日志行保持原样。

const { t } = require("./shell-locale");
const { terminateRecordedBackend } = require("./backend-emergency-stop");

// Hard cap on how long before-quit waits for the backend to stop. A normal
// quit is a user waiting in front of the tray menu, so the cap is short: a
// backend that is still there after 6s is reported in the log, not in a modal
// dialog (R3). The install path keeps the old, generous budget -- overwriting
// a live installation is the one case worth waiting (and failing) for.
const STOP_TIMEOUT_MS = 6_000;
const INSTALL_STOP_TIMEOUT_MS = 15_000;

/**
 * Per-quit stopwatch (R3-04 acceptance evidence).
 *
 * The quit used to be a black box that felt like 400–700ms of nothing; every
 * stage now stamps itself relative to the quit request and lands in
 * desktop-main.log. `mark()` logs the stage on its own line; `summary()` closes
 * the run with the one-line shape the issue asked for:
 *
 *   quit timing: stop requested at +0ms, taskkill exit +182ms, process gone
 *   +341ms, port probe +347ms, releasing quit +348ms
 *
 * A stage that never happened (no backend running, no taskkill on posix) reads
 * "n/a" instead of a made-up number.
 *
 * @param {number} startedAt `Date.now()` at the quit request.
 * @param {function(string): void} emit Log sink.
 */
function createQuitTimeline(startedAt, emit) {
  const marks = new Map();
  const elapsed = () => Date.now() - startedAt;
  const at = (label) => (marks.has(label) ? `+${marks.get(label)}ms` : "n/a");
  return {
    mark(label) {
      const ms = elapsed();
      marks.set(label, ms);
      emit(`quit timing: ${label} +${ms}ms`);
      return ms;
    },
    summary(label) {
      const ms = elapsed();
      marks.set(label, ms);
      emit(
        `quit timing: stop requested at ${at("stop requested")}, taskkill exit ${at("taskkill exit")}, ` +
          `process gone ${at("process gone")}, port probe ${at("port probe")}, ` +
          `${label} ${at(label)}`,
      );
      return ms;
    },
  };
}

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
 * @param {function(): (object|null)} [deps.getWindow] Returns the current main window;
 *     it is hidden before the backend stop (R3-A), so the user sees the quit immediately.
 * @param {function(): any} deps.getRestartTimer Returns the pending crash-restart timer.
 * @param {function(boolean): void} deps.setQuitting Writes main.js' `quitting` flag.
 * @param {function(string, number): {file: string, args: string[]}} deps.installerWaitCommand
 *     Builds the detached "wait for this pid, then run the installer" command.
 * @param {function(): object} deps.requireChildProcess Lazy accessor for child_process.
 * @param {function(Function, number): any} deps.setTimeout Timer venue of the caller.
 * @param {function(any): void} deps.clearTimeout Timer venue of the caller.
 * @param {function(): ("zh" | "en")} [deps.getLocale] Current shell locale for the two dialogs.
 * @returns {{requestInstallAndQuit: function(string): void, handleBeforeQuit: function(object): void,
 *   handleWillQuit: function(): void,
 *   getPendingInstallerPath: function(): (string|null), setPendingInstallerPath: function((string|null)): void}}
 *   The lifecycle surface; `handleBeforeQuit` is what `app.on("before-quit")` registers,
 *   `handleWillQuit` (registered internally) is the synchronous last-resort SIGTERM.
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
  const getLocale = typeof deps.getLocale === "function" ? deps.getLocale : () => "en";
  const getWindow = typeof deps.getWindow === "function" ? deps.getWindow : () => null;

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
  // 上一次异步停止的结论 { ok, reason, verified }：will-quit 的兜底靠它判断
  // "异步那条路确认成功了吗"。null = 还没跑过（等于"没确认"）。
  let lastStopOutcome = null;

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

  // R3-A: get the window out of sight BEFORE the backend stop. The stop takes
  // hundreds of milliseconds (spawn taskkill, confirmation polls, port probe);
  // with the window still up, the user reads that wait as "the click did
  // nothing". hide() is deliberately not close(): the close handler in main.js
  // is the ask-on-close / minimize-to-tray branch, and re-entering it here would
  // pop the dialog again (or turn the quit into a hide-to-tray). Electron's
  // hide() emits no "close" event, so `closeBehavior` is not reachable from here.
  // A window that is already gone (startup failure, macOS dock quit) is fine:
  // the stop must proceed either way.
  function hideMainWindow(timeline) {
    const win = getWindow();
    if (!win) return;
    try {
      if (typeof win.isDestroyed === "function" && win.isDestroyed()) return;
      win.hide();
      timeline.mark("window hidden");
    } catch (err) {
      // A hide that throws must never hold the quit: the stop below still runs.
      logLine(`quit: main window hide failed: ${err}`);
    }
  }

  // Stop the backend and normalise the outcome to { ok, reason }. The call
  // itself stays synchronous (the quit path must ask immediately); only the
  // result is awaited. A manager that reports nothing is treated as "completed"
  // (the pre-RR-02 contract) -- only an explicit ok:false blocks the install.
  //
  // `timeline` rides down through the manager so lib/backend-stop can stamp the
  // taskkill / process-gone / port-probe stages it owns.
  function stopBackendSafely(timeline) {
    const backend = getBackend();
    if (!backend) return Promise.resolve({ ok: true, reason: "", verified: true });
    backend.quitTimeline = timeline;
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
        const locale = getLocale();
        try {
          dialog.showErrorBox(
            t(locale, "app.name"),
            t(locale, "quit.installSpawnFailed.body"),
          );
        } catch {}
      });
      logLine(`install-spawned ${installerPath} (waits for shell pid ${process.pid})`);
    } catch (err) {
      logLine(`install-spawn-failed ${installerPath}: ${err}`);
    }
  }

  // will-quit 兜底：**同步**给记录中的后端补一刀 SIGTERM（lib/backend-emergency-stop.js）。
  //
  // 为什么要有这一层（2026-11-23，2.3.1 门禁 run 45017991307）：Linux 的四个矩阵里
  // 显式退出之后壳 177ms 就退了，uvicorn 还在端口上 accept。before-quit 的停止是异步
  // 的，它的结论依赖 manager 里的状态；只要那条路判错（或压根没拿到 pid），壳照样
  // 退出，后端就成了孤儿。这里不参与判断，只保证"壳要走了，后端跟着走"。
  //
  // 三个约束：同步（不等 Promise）、只打 manager 自己的记录（不按端口反查）、幂等
  // （异步停止已确认就一个信号都不发）。任何异常都只记一行——兜底失败不能盖掉
  // 真正的失败原因，更不能挡住 quit。
  function handleWillQuit() {
    try {
      const outcome = lastStopOutcome;
      const stopConfirmed = Boolean(outcome && outcome.ok === true && outcome.verified === true);
      const report = terminateRecordedBackend(getBackend(), { stopConfirmed });
      for (const line of report.log) logLine(line);
    } catch (err) {
      logLine(`quit fallback failed: ${err}`);
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
    // R3-04: the five stage stamps of this quit (see createQuitTimeline).
    const timeline = createQuitTimeline(Date.now(), logLine);
    timeline.mark("stop requested");
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
    // Window first, backend second: the install path hides too, but the
    // installer still waits for the stop (below) and the native error boxes
    // (shellDialogs / dialog.showErrorBox) stay visible without the window.
    hideMainWindow(timeline);
    const stopPromise = stopBackendSafely(timeline);
    const stopCapped = Promise.race([
      stopPromise,
      new Promise((resolve) => {
        scheduleTimeout(
          // reason 会出现在"安装被取消"的错误框里，所以它也是用户可见文案。
          () =>
            resolve({
              ok: false,
              reason: t(getLocale(), "quit.reason.stopTimeout"),
              verified: false,
              timedOut: true,
            }),
          stopTimeoutMs,
        ).unref();
      }),
    ]);
    stopCapped.then((outcome) => {
      stopInFlight = false;
      shutdownComplete = true;
      // will-quit 的兜底读它："异步停止确认成功了吗"只有这一个判据。
      lastStopOutcome = outcome;
      const stopOk = Boolean(outcome && outcome.ok);
      const stopVerified = !outcome || outcome.verified !== false;
      const locale = getLocale();
      const reason = (outcome && outcome.reason) || t(locale, "quit.reason.unknown");
      const backend = getBackend();
      const backendUrl = (backend && backend.url) || "（未知）";
      const probeDetail = (outcome && outcome.detail) || "（无）";
      // A1：端口还通时补杀监听进程的那一行证据（端口 → pid → 命令行 → 结果）。
      // 它由 backend-stop / backend-listener-rescue 产出，写在这里是因为 desktop-main.log
      // 的出口只有这一个（那两个文件也都贴着 500 行预算）。
      if (outcome && outcome.rescueLog) logLine(outcome.rescueLog);
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
            t(locale, "app.name"),
            t(locale, "quit.installBlocked.body", { reason }),
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
      timeline.summary("releasing quit");
      app.quit();
    });
  }

  // 兜底钩子的注册点放在**本模块**，不放在 main.js：before-quit 由 main.js 注册是
  // 因为 `quitting` 是那里的局部变量，而这条兜底只读本闭包里的状态
  // （lastStopOutcome / getBackend），main.js 的 500 行预算因此一行都不用动。
  // `app.on` 不存在时（离线用例的极简替身）只是不注册，其余行为不变。
  if (app && typeof app.on === "function") app.on("will-quit", handleWillQuit);

  return {
    requestInstallAndQuit,
    handleBeforeQuit,
    handleWillQuit,
    getPendingInstallerPath,
    setPendingInstallerPath,
  };
}

module.exports = { createQuitLifecycle };
