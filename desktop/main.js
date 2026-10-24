// SPDX-License-Identifier: Apache-2.0
"use strict";

// ResumeForge desktop shell - main process.
//
// Phase 2 scope: phase 1 window/splash/backend hosting plus tray residency,
// crash supervision with exponential backoff, and bundled-runtime unpacking
// (delegated to BackendManager). No console window ever appears; everything
// lands in the user-profile <runtimeDir>/logs/ (the payload is read-only).
//
// Quit lifecycle (audit PR-05): every exit path (tray exit, window close,
// update install, window-all-closed) funnels through app.quit() ->
// before-quit, which is the ONE place that stops the backend. The stop is
// awaited (with a hard cap) and only then is quit allowed to proceed; the
// update installer is spawned after the stop completes, never before.

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, screen, shell } = require("electron");
const path = require("path");
const { BackendManager } = require("./backend-manager");
const { createShellLogging, announceDegradedOnReady } = require("./lib/preflight");
const { resolveLogDir } = require("./lib/shell-paths");
const {
  clampToWorkArea,
  createWindowStateStore,
  initialBounds,
} = require("./lib/window-state");
const { createQuitLifecycle } = require("./lib/quit-lifecycle");
const { installerWaitCommand, runManualUpdateCheck, scheduleUpdateCheck, wantsManualUpdateCheck } = require("./updater");

// Lifecycle diagnostics use the controlled runtime log; module imports must not write user profiles.

let mainWindow = null;
let backend = null;
let tray = null;
// True once a quit is actually in progress (vs. a mere window close that
// hides to tray). Only before-quit sets it.
let quitting = false;
let restartAttempts = 0;
let restartTimer = null;

const MAX_RESTART_ATTEMPTS = 3;

// 1.5s, 4.5s, 13.5s -- enough to survive a transient port/file hiccup without
// hammering a genuinely broken backend.
const RESTART_BACKOFF_MS = 1500;
// Crash budget (audit PR-05): more than MAX_RESTART_ATTEMPTS unexpected
// exits inside this window give up on restarting and surface the error.
const RESTART_WINDOW_MS = 5 * 60_000;

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
  // Windows: %LOCALAPPDATA%\ResumeForge\runtime（安装版与便携版共用）。
  // macOS: userData 已按 productName 分好目录，再拼一次会让桌面壳与
  // scripts/macos/start.sh（默认 ~/Library/Application Support/ResumeForge/runtime）
  // 各写一套 pid 记录——壳读不到启动器记的后端，退出后端口仍被占。
  const base = process.env.LOCALAPPDATA || app.getPath("userData");
  return process.platform === "darwin"
    ? path.join(base, "runtime")
    : path.join(base, "ResumeForge", "runtime");
}

// ADR-0004: the database, attachments, exports and backups must live under
// the user profile, never inside the (possibly read-only) install payload.
// Electron's userData is %APPDATA%/<productName> on Windows.
function userDataDir() {
  return path.join(app.getPath("userData"), "data");
}

// 诊断日志只写用户目录（安装 payload 只读，写它只会 ENOENT/EPERM，见 P0）。
const shellLogging = createShellLogging({
  resolveRuntimeDir: runtimeDir,
  degradedHint: () => (backend && backend.logHint ? backend.logHint() : null),
});
const logLine = shellLogging.log;

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

function createTray() {
  // 512px 品牌图缩放在两个平台都够清晰，托盘与窗口共用同一张。
  tray = new Tray(shellIcon());
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

/** 窗口尺寸 / 位置 / 缩放的读写（纯函数在 lib/window-state.js，有离线用例）。 */
const windowState = createWindowStateStore({ app, getWindow: () => mainWindow });

function createWindow() {
  const remembered = windowState.read();
  const workAreaSize = screen.getPrimaryDisplay().workAreaSize;
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  // 有记忆就夹回可见区（拔掉副屏会落到屏幕外），没有就按工作区比例算（方案 §2.3.1）。
  const targetBounds =
    clampToWorkArea(remembered, screen.getAllDisplays()) ??
    initialBounds({
      x: primaryWorkArea.x,
      y: primaryWorkArea.y,
      width: workAreaSize.width,
      height: workAreaSize.height,
    });

  mainWindow = new BrowserWindow({
    ...targetBounds,
    // 1120：比 D 档下沿（1092）高，窗口再小也不会掉进 E 档；同时 1366×768 的笔记本
    // 仍能拖动窗口（minWidth 不是"支持下限"，方案附录 D4）。
    minWidth: 1120,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f7fa",
    icon: shellIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true, // 精确预览：内置 PDFium 渲染 blob PDF；默认 false 会让预览区空白
    },
  });
  mainWindow.setMenuBarVisibility(false);
  if (remembered && remembered.maximized) mainWindow.maximize();

  // 尺寸/位置：400ms 防抖后落盘（拖动时每一帧都写盘没有意义）。
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(windowState.save, 400);
  };
  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);

  // 缩放：`Ctrl+±` 由 Chromium 处理，这里只负责"记住"。写盘同样节流，且落盘时再夹一次
  // [0.8, 1.5]（`buildStatePayload`），超出范围说明用户已把自己放进未验收的档位。
  let zoomTimer = null;
  mainWindow.webContents.on("zoom-changed", () => {
    if (zoomTimer) clearTimeout(zoomTimer);
    zoomTimer = setTimeout(windowState.save, 500);
  });
  // 缩放系数必须在**导航完成之后**设置：对 about:blank 设置会被 loadURL 重置。
  const rememberedZoom = remembered?.zoomFactor;
  if (typeof rememberedZoom === "number" && rememberedZoom !== 1) {
    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow.webContents.setZoomFactor(rememberedZoom);
    });
  }

  mainWindow.loadFile(path.join(__dirname, "splash.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Closing the window minimizes to tray; real quits run through before-quit,
  // which flips `quitting` before the window is destroyed.
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    // 只有真实退出才写：hide-to-tray 时窗口还在，值可能是最大化前的。
    windowState.save();
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
        `诊断日志：${shellLogging.hint()}\n请重新启动应用。`,
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
    // 双保险：启动图先显示原因（用户至少看得见"哪一步坏了"），再把错误抛给
    // whenReady 的 catch 去弹可操作的对话框。**绝不能在这里吞掉**——只 logLine +
    // sendStage 的话外层永远收不到，用户就停在启动图的红框上，而关窗只是
    // hide() 到托盘（createWindow 的 close handler），应用既起不来也退不掉。
    sendStage("error", String(err && err.message ? err.message : err));
    throw err;
  }
}

// 启动失败时给用户的那条"打开日志目录"。日志目录的裁决只有一个出处
// （lib/shell-paths.js::resolveLogDir），这里只是把 runtimeDir 递进去，绝不另拼
// 一套路径；不可写时返回 null，由对话框如实说明"本次没写下日志"。
function startupLogDir() {
  return resolveLogDir({ runtimeDir: runtimeDir() }).dir;
}

// 启动失败的可操作出口（日志失效链修复）：启动图上的红框只有一行原因和一个需要
// 手动复制的路径，用户拿它没办法。这里收尾成一个**带按钮**的原生对话框：
// 「打开日志目录」/「退出」。刻意不用 dialog.showErrorBox —— 它不能带按钮
// （崩溃预算那条用它是对的：那条路没有可操作的下一步）。
//
// 两个按钮都以退出收尾：「打开日志目录」只是让日志可见，失败本身没有修复，
// 而留在托盘里的进程会让下一次启动撞上单实例锁、再失败一次。
function reportStartupFailure(err) {
  const message = err && err.message ? err.message : String(err);
  logLine(`startup failed: ${message}`);
  // 双保险：对话框被系统策略静默掉时，启动图仍然显示错误原因。
  sendStage("error", message);
  const logDir = startupLogDir();
  // 默认取「退出」：连对话框都弹不出来时必须收摊，不能留在半启动状态。
  let choice = 1;
  if (typeof dialog.showMessageBoxSync === "function") {
    try {
      choice = dialog.showMessageBoxSync({
        type: "error",
        title: "简历通",
        message: "启动失败",
        detail:
          `${message}\n\n` +
          (logDir
            ? "诊断日志目录：\n" +
              `${logDir}\n\n` +
              "把这里的 desktop-main.log 与 desktop-backend.log 提供给维护者，" +
              "可以定位这次启动失败。"
            : "本次运行没能写下诊断日志（安装目录与系统临时目录都不可写）。"),
        buttons: ["打开日志目录", "退出"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
    } catch (dialogError) {
      logLine(`startup failure dialog unavailable: ${dialogError}`);
    }
  }
  if (choice === 0 && logDir && shell && typeof shell.openPath === "function") {
    // openPath 用"返回错误字符串"而不是抛异常来报告失败；打不开不改变下面的结论。
    Promise.resolve(shell.openPath(logDir)).catch((openError) =>
      logLine(`open log dir failed: ${openError}`),
    );
  }
  // 必须先置 quitting：否则 createWindow 的 close handler 会 preventDefault
  // 把窗口藏进托盘，app.quit() 就再也走不完（本条正是"退不掉"的成因）。
  quitting = true;
  app.quit();
}

// Quit lifecycle (audit PR-05) now lives in ./lib/quit-lifecycle: the update
// install entry (requestInstallAndQuit), the backend stop (stopBackendSafely),
// the detached installer spawn and the whole before-quit body. Only the
// registration point below stays here, plus the `quitting` flag -- the window
// close handler (createWindow) and handleUnexpectedExit read that flag directly,
// and the lifecycle flips it through setQuitting, so the timing of the write
// (after preventDefault, before the stop starts) is unchanged.
//
// app/dialog are injected because the module must not require("electron"); the
// timer functions and a lazy child_process accessor are handed down so the VM
// lifecycle probes still see the shell's own timer venue and stubbed spawn.
const quitLifecycle = createQuitLifecycle({
  app,
  dialog,
  logLine,
  getBackend: () => backend,
  getRestartTimer: () => restartTimer,
  setQuitting: (value) => {
    quitting = value;
  },
  installerWaitCommand,
  requireChildProcess: () => require("child_process"),
  setTimeout,
  clearTimeout,
});

// Single instance: a second launch focuses the existing window instead of
// spawning a competing backend on another port.
if (!app.requestSingleInstanceLock()) {
  // 这里原本自己拼一条 <LOCALAPPDATA>\ResumeForge\startup-probe.log 并追加一行：
  // 那是第二套路径逻辑，而且桌面测试套件加载 main.js 时会把它写进真实用户目录。
  // 诊断信息改走壳的唯一日志出口 desktop-main.log（位置仍由 lib/shell-paths.js
  // 裁决，写不进去也只是丢一行诊断，绝不阻断退出）。
  logLine("single-instance lock denied; another ResumeForge instance owns the shell");
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // 应用已经在运行时双击更新入口：不启动第二个实例，直接走一次手动检查。
    if (wantsManualUpdateCheck(argv)) runManualUpdateCheck(mainWindow, logLine, { installAndQuit: quitLifecycle.requestInstallAndQuit });
  });

  app.whenReady().then(async () => {
    try {
      // 先体检再启动：安装目录只读是正常形态，降级只提示，绝不阻断启动。
      const preflightInfo = shellLogging.preflight();
      logLine("whenReady reached");
      createWindow();
      createTray();
      announceDegradedOnReady({ window: mainWindow, dialog, shell, info: preflightInfo });
      await startBackendAndSwap();
      scheduleUpdateCheck(mainWindow, logLine, { installAndQuit: quitLifecycle.requestInstallAndQuit });
      if (wantsManualUpdateCheck()) runManualUpdateCheck(mainWindow, logLine, { installAndQuit: quitLifecycle.requestInstallAndQuit });
    } catch (err) {
      // 一条可操作的出口：打开日志目录 / 退出（见 reportStartupFailure）。
      // 这里不再用 showErrorBox —— 它没有按钮，用户只能看着启动图。
      reportStartupFailure(err);
    }
  });

  // The single place that stops the backend (audit PR-05). The body lives in
  // ./lib/quit-lifecycle; the registration stays here so the ordering against
  // window-all-closed and the ipcMain quit bridge is visible in one file.
  app.on("before-quit", quitLifecycle.handleBeforeQuit);

  app.on("window-all-closed", () => {
    // With tray residency this only fires from an explicit destroy; treat
    // it as a quit request (before-quit stops the backend).
    app.quit();
  });
}
ipcMain.handle("splash:get-version", () => app.getVersion());
// R1：Chromium 打印。A08：把主窗口的取值函数交给打印桥——它只接受来自这个窗口顶层
// frame 的请求（iframe / webview / 被注入的页面一律拒绝），这里传 getter 而不是当前
// 实例，因为本行在 createWindow() 之前执行。
require("./print").registerPrintHandler({ getMainWindow: () => mainWindow });

// 桌面前端的「退出」按钮（preload 暴露的 window.splash.quitApp()）：只发
// app.quit()，让 before-quit 这个唯一停止点完成"停后端 → 必要时 spawn 安装器"
// 的既有顺序——绝不从这里另开退出路径。
ipcMain.on("app:quit-request", () => app.quit());

// Test hooks for the VM-based lifecycle probes (desktop/scripts/test-lifecycle.js).
// The packaged app runs main.js as its entry and never imports it as a module, so this is inert.
module.exports = { requestInstallAndQuit: quitLifecycle.requestInstallAndQuit };
