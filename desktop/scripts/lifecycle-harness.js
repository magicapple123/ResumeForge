// SPDX-License-Identifier: Apache-2.0
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
    // showMessageBoxSync 的每次调用（启动失败的可操作对话框就是这个出口）。
    messageBoxes: [],
    openPathCalls: [],
    stages: [],
    spawnCalls: [],
    installerChildren: [],
    timers: [],
  };

  const mainTmp = fs.mkdtempSync(path.join(os.tmpdir(), "rf-main-vm-"));
  // 桌面壳的日志目录来自 LOCALAPPDATA（见 main.js::runtimeDir）。把它指到本次
  // 用例的临时目录，加载 main.js 时就不会往真实用户 profile 里写 desktop-main.log
  // （C-10：桌面测试不许污染用户目录）。用例结束时由 cleanup() 复原并删目录。
  const realLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = mainTmp;
  const restoreEnv = () => {
    if (realLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = realLocalAppData;
  };

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
      this.webContents = {
        send: (channel, payload) => events.stages.push(payload),
      };
      // 记录注册过的窗口事件（close / ready-to-show）：用例要断言"启动失败后
      // 关窗不会被 preventDefault 拦成隐藏到托盘"。
      this.handlers = {};
      browserWindowInstances.push(this);
    }
    setMenuBarVisibility() {}
    loadFile() {
      return Promise.resolve();
    }
    loadURL() {
      return Promise.resolve();
    }
    once(name, handler) {
      this.handlers[name] = handler;
    }
    on(name, handler) {
      this.handlers[name] = handler;
    }
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

  // 「启动失败」的用例把 state.startBackend 设成一个抛错的函数，start() 就失败——
  // 这是唯一不需要真的起后端就能走到 whenReady catch 的办法。
  //
  // 另外三个开关专供边界用例：对话框被系统策略挡掉（抛异常）、系统缺少
  // showMessageBoxSync（连方法都没有）、以及 shell.openPath 用"返回错误字符串"或
  // "reject" 报告打不开目录——这些都必须只影响"日志有没有被打开"，不能影响"退出"。
  const state = {
    stopBackend: () => Promise.resolve({ ok: true, reason: "" }),
    startBackend: () => Promise.resolve("http://127.0.0.1:8010"),
    messageBoxThrows: false,
    openPathError: "",
    openPathRejects: null,
  };

  const dialogStub = {
    showErrorBox: (title, message) => {
      events.errorBoxes.push(message);
    },
    // 启动失败的可操作对话框：记录选项并返回用例预设的按钮序号（默认「退出」）。
    showMessageBoxSync(options) {
      events.messageBoxes.push(options);
      if (state.messageBoxThrows) throw new Error("dialog blocked by system policy");
      return state.messageBoxResponse ?? 1;
    },
  };

  const shellStub = {
    openPath(target) {
      events.openPathCalls.push(target);
      if (state.openPathRejects) return Promise.reject(new Error(state.openPathRejects));
      return Promise.resolve(state.openPathError || "");
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
  class BackendManagerStub {
    constructor() {
      backendInstances.push(this);
      this.onUnexpectedExit = null;
      this.url = "http://127.0.0.1:8010";
    }
    start() {
      return state.startBackend();
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
    // R11: the install-root --check-update entry. The harness only needs the
    // surface main.js calls; the real behaviour lives in test-manual-update-entry.js.
    wantsManualUpdateCheck() {
      return false;
    },
    runManualUpdateCheck() {},
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
          shell: shellStub,
        };
      }
      if (spec === "./backend-manager") {
        return { BackendManager: BackendManagerStub };
      }
      if (spec === "./print") {
        // R1：打印通道与生命周期无关，只保证主进程能加载。
        return { registerPrintHandler() {} };
      }
      if (spec === "./updater") {
        return updaterStub;
      }
      if (spec === "child_process") {
        return childProcessStub;
      }
      // main.js 的其余相对依赖（如 ./lib/preflight）指向 desktop/ 下的真实模块：
      // 沙箱里的 require 是 harness 自己的，不按 main.js 的位置解析相对路径。
      if (spec.startsWith(".")) return require(path.join(REPO_DESKTOP, spec));
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
    // 启动失败的可操作对话框用例要读窗口上的 close 处理器。
    windowInstances: browserWindowInstances,
    exports: sandbox.module.exports,
    state,
    // 「系统里没有这个方法」的边界用例要能把它们删掉（模拟旧版 Electron /
    // 平台不支持），所以把 stub 本体也交出去。
    dialogStub,
    shellStub,
    cleanup: () => {
      restoreEnv();
      fs.rmSync(mainTmp, { recursive: true, force: true });
    },
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
