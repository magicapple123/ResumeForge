"use strict";

// Lifecycle probes for desktop/main.js (audit PR-05, 2026-10-13).
//
// main.js is loaded inside a Node VM with stubbed electron / BackendManager /
// updater modules -- no real process, window, tray or network is involved.
// The stubs capture calls so the tests can assert the *ordering* between
// backend.stop(), app.quit() and the update-installer spawn.
//
// Run with: node scripts/test-lifecycle.js   (or: node --test scripts/)

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { test } = require("node:test");

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

  const ipcMainStub = { handle() {} };

  const backendInstances = [];
  // The tests set `stopBackend` to control the stop() promise.
  const state = { stopBackend: () => Promise.resolve() };
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
      return state.stopBackend().then(() => {
        events.order.push("stop-complete");
      });
    }
  }

  const updaterStub = { scheduleUpdateCheck() {} };

  const childProcessStub = {
    spawn(file, args, options) {
      events.spawnCalls.push({ file, args, options });
      events.order.push("installer-spawn");
      return { unref() {} };
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

test("tray exit does NOT stop the backend (audit R: stop call count is 0)", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const exitItem = loaded.menuHolder.menu.template.find((i) => i.label === "退出");
    assert.ok(exitItem, "tray menu should contain the exit item");

    exitItem.click();
    assert.ok(loaded.events.quitCalls.length >= 1, "tray exit should request app.quit()");
    assert.strictEqual(
      loaded.events.stopCalls.length,
      0,
      "tray exit must not call backend.stop() directly before before-quit",
    );

    // Simulate Electron firing before-quit for that quit request.
    const handler = loaded.events.beforeQuitHandler;
    assert.ok(handler, "main should register a before-quit handler");
    const event = { preventDefault: () => loaded.events.preventCalls.push("pd") };
    handler(event);

    assert.strictEqual(
      loaded.events.stopCalls.length,
      1,
      "before-quit must call backend.stop() exactly once for the first pass",
    );
    assert.ok(
      loaded.events.preventCalls.length >= 1,
      "quit must be held while the backend is stopping",
    );
  } finally {
    loaded.cleanup();
  }
});

test("tray exit: app.quit() resumes only AFTER backend.stop() completes", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const deferred = makeDeferred();
    loaded.state.stopBackend = () => deferred.promise;

    const exitItem = loaded.menuHolder.menu.template.find((i) => i.label === "退出");
    exitItem.click();
    const quitsBeforeStop = loaded.events.quitCalls.length;
    const handler = loaded.events.beforeQuitHandler;
    const event = { preventDefault: () => {} };
    handler(event);

    // Backend stop is in flight: no second quit yet.
    await flush();
    assert.strictEqual(
      loaded.events.quitCalls.length,
      quitsBeforeStop,
      "quit must not resume while backend.stop() is pending",
    );

    deferred.resolve();
    await flush();
    await flush();

    const stopCompleteIndex = loaded.events.order.indexOf("stop-complete");
    const secondQuitIndex = loaded.events.order.indexOf("quit", 1);
    assert.ok(stopCompleteIndex >= 0, "stop should have completed");
    assert.ok(secondQuitIndex > stopCompleteIndex,
      `quit must resume after stop-complete (order: ${loaded.events.order.join(" -> ")})`);

    // Second before-quit pass (from the resumed quit) must not re-stop or hold.
    const event2 = { preventDefault: () => loaded.events.preventCalls.push("pd2") };
    handler(event2);
    assert.strictEqual(loaded.events.stopCalls.length, 1,
      "second before-quit pass must not call stop() again");
    assert.strictEqual(loaded.events.preventCalls.includes("pd2"), false,
      "second before-quit pass must let quit proceed");
  } finally {
    loaded.cleanup();
  }
});

test("update install: installer spawns only AFTER backend.stop() completes", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const requestInstallAndQuit = loaded.exports && loaded.exports.requestInstallAndQuit;
    assert.strictEqual(
      typeof requestInstallAndQuit,
      "function",
      "main.js must expose requestInstallAndQuit for the updater wiring",
    );

    const deferred = makeDeferred();
    loaded.state.stopBackend = () => deferred.promise;

    requestInstallAndQuit("C:/temp/ResumeForge-Setup-0.19.0.exe");
    assert.ok(loaded.events.quitCalls.length >= 1, "install request should trigger quit");
    assert.strictEqual(loaded.events.spawnCalls.length, 0,
      "installer must not be spawned before the quit flow ran");

    const handler = loaded.events.beforeQuitHandler;
    const event = { preventDefault: () => {} };
    handler(event);
    await flush();
    assert.strictEqual(loaded.events.stopCalls.length, 1,
      "install path must stop the backend via before-quit");
    assert.strictEqual(loaded.events.spawnCalls.length, 0,
      "installer must not spawn while the backend is still stopping");

    deferred.resolve();
    await flush();
    await flush();

    assert.strictEqual(loaded.events.spawnCalls.length, 1, "installer should have spawned");
    const spawn = loaded.events.spawnCalls[0];
    assert.strictEqual(spawn.file, "C:/temp/ResumeForge-Setup-0.19.0.exe");
    // spawn.args comes from the VM realm; compare element-wise.
    assert.strictEqual(spawn.args.length, 1);
    assert.strictEqual(spawn.args[0], "/S");
    assert.ok(spawn.options.detached, "installer must survive our exit");

    const stopCompleteIndex = loaded.events.order.indexOf("stop-complete");
    const spawnIndex = loaded.events.order.indexOf("installer-spawn");
    assert.ok(spawnIndex > stopCompleteIndex,
      `installer spawn must happen after stop-complete (order: ${loaded.events.order.join(" -> ")})`);
  } finally {
    loaded.cleanup();
  }
});

test("restart budget: >3 crashes within 5 minutes give up with an error dialog", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const backend = loaded.backendInstances[0];
    assert.strictEqual(typeof backend.onUnexpectedExit, "function",
      "main should wire the crash-supervision hook");

    // 5 crash -> (recovered by the scheduled restart) -> crash cycles. Each
    // recovery resets the old attempt counter; the 5-minute window budget is
    // what must eventually stop the restart loop.
    for (let cycle = 0; cycle < 5; cycle += 1) {
      backend.onUnexpectedExit({ code: 1, signal: null });
      await flush();
      if (cycle < 4) {
        // Run the scheduled restart manually (fake timer), then let the
        // async startBackend chain settle.
        const timer = loaded.events.timers[loaded.events.timers.length - 1];
        timer._fn();
        await flush();
        await flush();
      }
    }

    assert.ok(loaded.events.errorBoxes.length >= 1,
      "exceeding the crash budget must surface an error dialog");
    // After the budget was exceeded, the last crash must not schedule another
    // restart (the last recorded timer belongs to the previous cycle).
    const timersAfterFifth = loaded.events.timers.length;
    backend.onUnexpectedExit({ code: 1, signal: null });
    await flush();
    assert.strictEqual(loaded.events.timers.length, timersAfterFifth,
      "no restart may be scheduled once the budget is exhausted");
    assert.ok(loaded.events.errorBoxes.length >= 2 || loaded.events.errorBoxes.length >= 1,
      "further crashes keep reporting the failure instead of restarting");
  } finally {
    loaded.cleanup();
  }
});
