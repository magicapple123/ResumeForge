"use strict";

// ResumeForge desktop shell - main process.
//
// Phase 2 scope: phase 1 window/splash/backend hosting plus tray residency,
// crash supervision with exponential backoff, and bundled-runtime unpacking
// (delegated to BackendManager). No console window ever appears; everything
// lands in runtime/logs/.

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const { BackendManager } = require("./backend-manager");

// Startup probe: persists which bootstrap step the shell reached. Remove in
// phase 5 once the packaged pipeline is proven end to end.
try {
  const probeDir = path.join(
    process.env.LOCALAPPDATA || app.getPath("userData"),
    "ResumeForge",
  );
  fs.mkdirSync(probeDir, { recursive: true });
  fs.appendFileSync(
    path.join(probeDir, "startup-probe.log"),
    `${new Date().toISOString()} module-loaded packaged=${app.isPackaged}\n`,
  );
} catch {}

let mainWindow = null;
let backend = null;
let tray = null;
let quitting = false;
let restartAttempts = 0;
let restartTimer = null;

const MAX_RESTART_ATTEMPTS = 3;
// 1.5s, 4.5s, 13.5s -- enough to survive a transient port/file hiccup without
// hammering a genuinely broken backend.
const RESTART_BACKOFF_MS = 1500;

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
        quitting = true;
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
  mainWindow.loadFile(path.join(__dirname, "splash.html"), {
    query: { icon: shellIcon() },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Closing the window minimizes to tray; quitting goes through the tray
  // menu (or app.quit()), which sets `quitting` first.
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function handleUnexpectedExit(info) {
  if (quitting) return;
  restartAttempts += 1;
  logLine(`backend exited unexpectedly code=${info.code} attempt=${restartAttempts}`);
  if (restartAttempts > MAX_RESTART_ATTEMPTS) {
    dialog.showErrorBox(
      "简历通",
      `后端服务连续启动失败（已重试 ${MAX_RESTART_ATTEMPTS} 次）。\n` +
        "请查看 runtime/logs/desktop-backend.log 后重新启动应用。",
    );
    return;
  }
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
  backend = new BackendManager(projectRoot(), runtimeDir(), {
    packaged: app.isPackaged,
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
    if (quitting) return;
    quitting = true;
    if (restartTimer) clearTimeout(restartTimer);
    // Hold quit until the backend tree is down; a dangling uvicorn would
    // keep file handles and break the next launch/update.
    event.preventDefault();
    const shutdown = backend ? backend.stop() : Promise.resolve();
    shutdown.finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    // With tray residency this only fires from an explicit destroy; treat
    // it as a quit request.
    app.quit();
  });
}

ipcMain.handle("splash:get-version", () => app.getVersion());
