"use strict";

// ResumeForge desktop shell - main process.
//
// Phase 2 scope: phase 1 window/splash/backend hosting plus tray residency,
// crash supervision with exponential backoff, and bundled-runtime unpacking
// (delegated to BackendManager). No console window ever appears; everything
// lands in runtime/logs/.
//
// Quit lifecycle (audit PR-05): every exit path (tray exit, window close,
// update install, window-all-closed) funnels through app.quit() ->
// before-quit, which is the ONE place that stops the backend. The stop is
// awaited (with a hard cap) and only then is quit allowed to proceed; the
// update installer is spawned after the stop completes, never before.

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const { BackendManager } = require("./backend-manager");
const { scheduleUpdateCheck } = require("./updater");

// Lifecycle diagnostics use the controlled runtime log; module imports must not write user profiles.

let mainWindow = null;
let backend = null;
let tray = null;
// True once a quit is actually in progress (vs. a mere window close that
// hides to tray). Only before-quit sets it.
let quitting = false;
// before-quit state machine: quit is held while the backend stops, then
// resumed exactly once.
let stopInFlight = false;
let shutdownComplete = false;
// Set by the updater's installAndQuit dependency; the installer spawns in
// before-quit AFTER the backend stop completes.
let pendingInstallerPath = null;
let restartAttempts = 0;
let restartTimer = null;

const MAX_RESTART_ATTEMPTS = 3;
// 1.5s, 4.5s, 13.5s -- enough to survive a transient port/file hiccup without
// hammering a genuinely broken backend.
const RESTART_BACKOFF_MS = 1500;
// Crash budget (audit PR-05): more than MAX_RESTART_ATTEMPTS unexpected
// exits inside this window give up on restarting and surface the error.
const RESTART_WINDOW_MS = 5 * 60_000;
// Hard cap on how long before-quit waits for the backend to stop.
const STOP_TIMEOUT_MS = 10_000;

const restartTimestamps = [];

function projectRoot() {
  // Packaged: the release pipeline assembles resources/payload (backend,
  // frontend/dist, scripts, branding) next to the shell.
  return app.isPackaged
    ? path.join(process.resourcesPath, "payload")
    : path.join(__dirname, "..");
}

function shellIcon() {
  // electron-builder may drop icon.png from the asar (buildResources clash),
  // so the packaged app reads the extraResources copy next to the payload.
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "icon.png");
}

function runtimeDir() {
  // Shared by installer and portable forms so switching between them keeps
  // user data and the unpacked runtime.
  const base = process.env.LOCALAPPDATA || app.getPath("userData");
  return path.join(base, "ResumeForge", "runtime");
}

// ADR-0004: the database, attachments, exports and backups must live under
// the user profile, never inside the (possibly read-only) install payload.
// Electron's userData is %APPDATA%/<productName> on Windows.
function userDataDir() {
  return path.join(app.getPath("userData"), "data");
}

function logLine(message) {
  try {
    const logDir = path.join(projectRoot(), "runtime", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "desktop-main.log"),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {
    // Logging must never take the shell down.
  }
}

// ADR-0004 legacy-data migration: asks the user before moving the payload-era
// data into the user data dir. The module is required lazily (inside the
// packaged-only path) so the dev-tree lifecycle probes, which load this file
// in a VM with app.isPackaged = false, never resolve it.
function confirmDataMigration(details) {
  const incomplete =
    details.reason === "marker-without-database"
      ? "\n\n注意：上一次迁移的标记还在，但新位置已经找不到数据库文件" +
        "（可能被移动、删除或同步工具移走）。现在重新迁移会从旧位置再复制一份。"
      : "";
  return dialog
    .showMessageBox({
      type: "question",
      title: "简历通",
      message: "检测到旧版本数据",
      detail:
        "检测到旧版本的数据仍保存在安装目录内。是否迁移到新的用户数据目录？" +
        "旧数据将保留备份，迁移失败时旧数据也原样保留。" +
        incomplete +
        `\n\n旧位置：${details.from}\n新位置：${details.to}`,
      buttons: ["迁移", "暂不迁移"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    .then(({ response }) => response === 0);
}

// Marker present but no database anywhere: fail closed and let the user pick
// between restoring a backup (quit) and explicitly starting from scratch.
async function recoverMissingData(message) {
  const { response } = await dialog.showMessageBox({
    type: "error",
    title: "简历通",
    message: "数据目录需要确认",
    detail: `${message}\n\n「创建全新数据库」会删除上一次迁移的标记并在新位置新建一份空数据库。`,
    buttons: ["退出（先去恢复备份）", "创建全新数据库"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return response === 1;
}

// Resolves to { userDataDir, aborted }: null userDataDir keeps the legacy
// (payload) location for this launch (declined / failed migration); aborted
// means the shell must quit instead of starting the backend (RR-06).
async function resolveUserDataDir() {
  const { maybeMigrateUserData, clearMarker } = require("./lib/data-migration");
  const result = await maybeMigrateUserData({
    oldDataDir: path.join(projectRoot(), "backend", "data"),
    newDataDir: userDataDir(),
    showConfirm: confirmDataMigration,
    showError: (title, message) => dialog.showErrorBox(title, message),
    log: logLine,
  });
  if (result.outcome === "inconsistent") {
    logLine("data dir inconsistent: marker without database; asking the user");
    const startFresh = await recoverMissingData(result.message);
    if (!startFresh) return { userDataDir: null, aborted: true };
    clearMarker(userDataDir());
    logLine("data dir inconsistent: user chose to start with a fresh database");
    return { userDataDir: userDataDir(), aborted: false };
  }
  return { userDataDir: result.userDataDir, aborted: false };
}

function sendStage(stage, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("splash:stage", { stage, detail });
  }
}

function trayIconPath() {
  // Small imagery for the tray; the 512px brand png scales fine on both OSes.
  return shellIcon();
}

function createTray() {
  tray = new Tray(trayIconPath());
  tray.setToolTip("简历通");
  const menu = Menu.buildFromTemplate([
    {
      label: "打开简历通",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        // No `quitting` shortcut here: app.quit() fires before-quit, which is
        // the single place that stops the backend (audit PR-05).
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  // Left-click also restores the window (Windows convention).
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f7fa",
    icon: shellIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "splash.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Closing the window minimizes to tray; real quits run through before-quit,
  // which flips `quitting` before the window is destroyed.
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function handleUnexpectedExit(info) {
  if (quitting) return;
  // Rolling crash budget: count unexpected exits inside the window.
  const now = Date.now();
  while (restartTimestamps.length && now - restartTimestamps[0] >= RESTART_WINDOW_MS) {
    restartTimestamps.shift();
  }
  restartTimestamps.push(now);
  if (restartTimestamps.length > MAX_RESTART_ATTEMPTS) {
    logLine(
      `backend crash budget exhausted (${restartTimestamps.length} exits in ` +
        `${RESTART_WINDOW_MS / 60000} min), giving up`,
    );
    dialog.showErrorBox(
      "简历通",
      `后端服务在 ${RESTART_WINDOW_MS / 60000} 分钟内连续异常退出 ${restartTimestamps.length} 次，已停止自动重启。\n` +
        "请查看 runtime/logs/desktop-backend.log 后重新启动应用。",
    );
    return;
  }

  restartAttempts += 1;
  logLine(`backend exited unexpectedly code=${info.code} attempt=${restartAttempts}`);
  sendStage("backend-restarting", String(restartAttempts));
  const delay = RESTART_BACKOFF_MS * Math.pow(3, restartAttempts - 1);
  restartTimer = setTimeout(() => {
    if (quitting) return;
    startBackend()
      .then(() => {
        restartAttempts = 0;
      })
      .catch((err) => {
        logLine(`restart failed: ${err}`);
        handleUnexpectedExit({ code: "restart-failed" });
      });
  }, delay);
}

async function startBackend() {
  const url = await backend.start((stage) => sendStage(stage));
  await mainWindow.loadURL(url);
  return url;
}

async function startBackendAndSwap() {
  // ADR-0004: packaged installs keep user data under the profile; dev runs
  // keep the repo-local backend/data behavior unchanged. The migration runs
  // BEFORE the backend spawns (a declined or failed migration yields null ->
  // the backend falls back to the legacy location, everything as before).
  const resolved = app.isPackaged ? await resolveUserDataDir() : { userDataDir: null };
  if (resolved.aborted) {
    // The user chose to fix the data directory first: never start a backend
    // that would create an empty database next to missing data (RR-06).
    logLine("startup aborted: data directory needs recovery");
    app.quit();
    return;
  }
  const effectiveUserDataDir = resolved.userDataDir;
  backend = new BackendManager(projectRoot(), runtimeDir(), {
    packaged: app.isPackaged,
    userDataDir: effectiveUserDataDir,
  });
  backend.onUnexpectedExit = handleUnexpectedExit;
  try {
    await startBackend();
    restartAttempts = 0;
  } catch (err) {
    logLine(`backend start failed: ${err}`);
    sendStage("error", String(err && err.message ? err.message : err));
  }
}

// Called by the updater once the installer checksum verified: quit first;
// before-quit stops the backend and spawns the installer afterwards.
function requestInstallAndQuit(installerPath) {
  pendingInstallerPath = installerPath;
  app.quit();
}

// Stop the backend and normalise the outcome to { ok, reason }. The call
// itself stays synchronous (the quit path must ask immediately); only the
// result is awaited. A manager that reports nothing is treated as "completed"
// (the pre-RR-02 contract) -- only an explicit ok:false blocks the install.
function stopBackendSafely() {
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
  if (!pendingInstallerPath) return;
  const installerPath = pendingInstallerPath;
  pendingInstallerPath = null;
  try {
    const child = require("child_process").spawn(installerPath, ["/S"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    child.on("error", (err) => {
      logLine(`update installer spawn failed: ${err}`);
      try { dialog.showErrorBox("简历通", "更新安装程序未能启动，请保留下载文件后手动重试。"); } catch {}
    });
    logLine(`update installer spawned: ${installerPath}`);
  } catch (err) {
    logLine(`update installer spawn failed: ${err}`);
  }
}

// Single instance: a second launch focuses the existing window instead of
// spawning a competing backend on another port.
if (!app.requestSingleInstanceLock()) {
  try {
    const probeDir = path.join(
      process.env.LOCALAPPDATA || app.getPath("userData"),
      "ResumeForge",
    );
    fs.appendFileSync(
      path.join(probeDir, "startup-probe.log"),
      `${new Date().toISOString()} single-instance-lock-denied\n`,
    );
  } catch {}
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      logLine("whenReady reached");
      createWindow();
      createTray();
      await startBackendAndSwap();
      scheduleUpdateCheck(mainWindow, logLine, { installAndQuit: requestInstallAndQuit });
    } catch (err) {
      logLine(`startup failed: ${err}`);
      dialog.showErrorBox(
        "简历通",
        `启动失败：${err && err.message ? err.message : err}`,
      );
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    // Second pass after the stop completed (and the installer, if any, was
    // spawned): let quit proceed.
    if (shutdownComplete) return;
    if (stopInFlight) {
      // Re-entrant quit request while the stop is already running.
      event.preventDefault();
      return;
    }
    event.preventDefault();
    quitting = true;
    stopInFlight = true;
    if (restartTimer) clearTimeout(restartTimer);
    // Hold quit until the backend tree is down; a dangling uvicorn would
    // keep file handles and break the next launch/update. The cap bounds
    // the wait even if the backend's own stop logic hangs.
    //
    // RR-02: "we asked it to stop" is not "it stopped". The stop outcome is
    // checked before the update installer is allowed to overwrite this
    // installation: an unverified stop (recycled pid, unreadable identity,
    // timeout) must never be papered over by an install.
    const stopPromise = stopBackendSafely();
    const stopCapped = Promise.race([
      stopPromise,
      new Promise((resolve) => {
        setTimeout(
          () => resolve({ ok: false, reason: "停止后端超时", verified: false, timedOut: true }),
          STOP_TIMEOUT_MS,
        ).unref();
      }),
    ]);
    stopCapped.then((outcome) => {
      stopInFlight = false;
      shutdownComplete = true;
      if (outcome && outcome.ok) {
        spawnPendingInstaller();
      } else {
        const reason = (outcome && outcome.reason) || "未知原因";
        const hadPendingInstaller = Boolean(pendingInstallerPath);
        pendingInstallerPath = null;
        logLine(`backend stop not verified (${reason}); update install blocked`);
        try {
          dialog.showErrorBox(
            "简历通",
            hadPendingInstaller
              ? `更新未安装：后端服务未被确认停止（${reason}）。\n` +
                  "为避免覆盖仍在使用数据文件的后端进程，安装已取消。" +
                  "请手动结束残留的后端进程后重试更新。"
              : `退出时未能确认后端服务已停止（${reason}）。\n` +
                  "如果稍后发现端口被占用，请在任务管理器里结束残留的 python 进程。",
          );
        } catch {
          // A failing dialog must not block the quit itself.
        }
      }
      app.quit();
    });
  });

  app.on("window-all-closed", () => {
    // With tray residency this only fires from an explicit destroy; treat
    // it as a quit request (before-quit stops the backend).
    app.quit();
  });
}

ipcMain.handle("splash:get-version", () => app.getVersion());

// Test hooks for the VM-based lifecycle probes
// (desktop/scripts/test-lifecycle.js). The packaged app runs main.js as its
// entry and never imports it as a module, so this is inert at runtime.
module.exports = { requestInstallAndQuit };
