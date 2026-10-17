"use strict";

// Shared VM harness for desktop/main.js lifecycle probes.
//
// Named without the ``test-`` prefix on purpose: ``node --test "scripts/test-*.js"``
// must not pick this file up as a suite of its own. main.js is loaded inside a
// Node VM with stubbed electron / BackendManager / updater modules -- no real
// process, window, tray or network is involved. The stubs capture calls so the
// tests can assert the *ordering* between backend.stop(), app.quit() and the
// update-installer spawn.

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const vm = require("vm");
const { EventEmitter } = require("node:events");

const REPO_DESKTOP = path.join(__dirname, "..");

// A deferred promise the tests resolve manually to control when "the backend
// finished stopping" happens.
function makeDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function flush() {
  // Let the VM's async whenReady handler and promise chains settle.
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

function loadMain() {
  const events = {
    quitCalls: [],
    stopCalls: [],
    order: [],
    preventCalls: [],
    errorBoxes: [],
    spawnCalls: [],
    installerChildren: [],
    timers: [],
  };

  const mainTmp = fs.mkdtempSync(path.join(os.tmpdir(), "rf-main-vm-"));

  const appStub = {
    isPackaged: false,
    quit() {
      events.quitCalls.push("quit");
      events.order.push("quit");
    },
    requestSingleInstanceLock() {
      return true;
    },
    whenReady() {
      return Promise.resolve();
    },
    on(name, handler) {
      if (name === "before-quit") events.beforeQuitHandler = handler;
    },
    getPath(name) {
      return mainTmp;
    },
    getVersion() {
      return "0.18.0";
    },
  };

  const browserWindowInstances = [];
  class BrowserWindowStub {
    constructor() {
      this.webContents = { send() {} };
      browserWindowInstances.push(this);
    }
    setMenuBarVisibility() {}
    loadFile() {
      return Promise.resolve();
    }
    loadURL() {
      return Promise.resolve();
    }
    once() {}
    on() {}
    show() {}
    hide() {}
    focus() {}
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    restore() {}
  }

  const menuHolder = {};
  class TrayStub {
    setToolTip() {}
    setContextMenu(menu) {
      menuHolder.menu = menu;
    }
    on() {}
  }
  const MenuStub = {
    buildFromTemplate: (template) => ({ template }),
  };

  const dialogStub = {
    showErrorBox: (title, message) => {
      events.errorBoxes.push(message);
    },
  };

  const ipcMainStub = {
    handle() {},
    // main.js registers app:quit-request (the preload quitApp bridge); the
    // probes capture the handler so tests can assert it funnels into app.quit().
    on(name, handler) {
      if (name === "app:quit-request") events.quitRequestHandler = handler;
    },
  };

  const backendInstances = [];
  // The tests set `stopBackend` to control the stop() promise; it resolves to
  // the stop outcome ({ ok, reason }) that RR-02 introduced.
  const state = { stopBackend: () => Promise.resolve({ ok: true, reason: "" }) };
  class BackendManagerStub {
    constructor() {
      backendInstances.push(this);
      this.onUnexpectedExit = null;
    }
    async start() {
      return "http://127.0.0.1:8010";
    }
    stop() {
      events.stopCalls.push("stop");
      events.order.push("stop-start");
      return state.stopBackend().then((outcome) => {
        events.order.push("stop-complete");
        return outcome === undefined ? { ok: true, reason: "" } : outcome;
      });
    }
  }

  const updaterStub = {
    scheduleUpdateCheck() {},
    // Deterministic stand-in for the real installerWaitCommand(): the pure
    // function itself is unit-tested against the real module in
    // test-updater.js; here we only need main.js's spawn wiring to be
    // observable.
    installerWaitCommand(installerPath, mainPid) {
      return {
        file: "powershell",
        args: [
          "-NoProfile",
          "-WindowStyle",
          "Hidden",
          "-Command",
          `Wait-Process -Id ${mainPid} -ErrorAction SilentlyContinue; ` +
            `Start-Process -FilePath '${installerPath}' -ArgumentList '/S'`,
        ],
      };
    },
  };

  const childProcessStub = {
    spawn(file, args, options) {
      events.spawnCalls.push({ file, args, options });
      events.order.push("installer-spawn");
      const child = new EventEmitter();
      child.unref = () => {};
      events.installerChildren.push(child);
      return child;
    },
  };

  const sandbox = {
    console,
    process,
    Buffer,
    Promise,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Error,
    Math,
    setTimeout(fn, ms) {
      // Captured fake timer: crash-restart backoffs must never actually fire
      // during the test; tests may invoke the recorded callback manually.
      const handle = { _fn: fn, _ms: ms, unref() {} };
      events.timers.push(handle);
      return handle;
    },
    clearTimeout() {},
    setImmediate,
    require(spec) {
      if (spec === "electron") {
        return {
          app: appStub,
          BrowserWindow: BrowserWindowStub,
          Tray: TrayStub,
          Menu: MenuStub,
          dialog: dialogStub,
          ipcMain: ipcMainStub,
        };
      }
      if (spec === "./backend-manager") {
        return { BackendManager: BackendManagerStub };
      }
      if (spec === "./updater") {
        return updaterStub;
      }
      if (spec === "child_process") {
        return childProcessStub;
      }
      return require(spec);
    },
    module: { exports: {} },
    __filename: path.join(REPO_DESKTOP, "main.js"),
    __dirname: REPO_DESKTOP,
  };

  const source = fs.readFileSync(path.join(REPO_DESKTOP, "main.js"), "utf-8");
  vm.runInNewContext(source, sandbox, { filename: "desktop/main.js" });

  return {
    events,
    appStub,
    menuHolder,
    backendInstances,
    exports: sandbox.module.exports,
    state,
    cleanup: () => fs.rmSync(mainTmp, { recursive: true, force: true }),
  };
}

async function waitForShellReady(loaded) {
  // The whenReady handler is async: window + tray + backend start.
  await flush();
  await flush();
  assert.ok(loaded.menuHolder.menu, "tray menu should have been created");
  assert.ok(loaded.backendInstances.length >= 1, "backend should have been created");
}

module.exports = { flush, loadMain, makeDeferred, waitForShellReady };
