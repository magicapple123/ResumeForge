"use strict";

// ResumeForge desktop shell - main process.
//
// Phase 1 scope: open a branded frameless-of-chrome native window instantly,
// show a splash progress page, spawn the backend via BackendManager, and swap
// the window over to the app once /api/health passes. Console windows never
// appear: Electron runs windowed and the backend logs to a file.

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { BackendManager } = require("./backend-manager");

let mainWindow = null;
let backend = null;

function projectRoot() {
  return path.join(__dirname, "..");
}

function sendStage(stage, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("splash:stage", { stage, detail });
  }
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
    icon: path.join(projectRoot(), "branding", "resumeforge.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "splash.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

async function startBackendAndSwap() {
  backend = new BackendManager(projectRoot());
  try {
    const url = await backend.start((stage) => sendStage(stage));
    // The app replaces the splash in the same window; keep the frame so the
    // swap reads as one continuous launch.
    await mainWindow.loadURL(url);
  } catch (err) {
    sendStage("error", String(err && err.message ? err.message : err));
  }
}

// Single instance: a second launch focuses the existing window instead of
// spawning a competing backend on another port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    startBackendAndSwap();
  });

  app.on("window-all-closed", () => {
    // The backend is ours to clean up; stop it before quitting.
    const shutdown = backend ? backend.stop() : Promise.resolve();
    shutdown.finally(() => app.quit());
  });
}

ipcMain.handle("splash:get-version", () => app.getVersion());
