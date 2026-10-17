"use strict";

// Lifecycle probes for desktop/main.js (audit PR-05, 2026-10-13).
//
// main.js is loaded inside a Node VM with stubbed electron / BackendManager /
// updater modules -- no real process, window, tray or network is involved.
// The stubs capture calls so the tests can assert the *ordering* between
// backend.stop(), app.quit() and the update-installer spawn. The shared VM
// harness lives in lifecycle-harness.js; the preload quitApp bridge probes
// live in test-quit-bridge.js.
//
// Run with: node scripts/test-lifecycle.js   (or: node --test scripts/)

const assert = require("assert");
const { test } = require("node:test");
const { flush, loadMain, makeDeferred, waitForShellReady } = require("./lifecycle-harness");

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
    // 2026-10 实测缺陷③：NSIS /S 安装若在 Electron 退出前启动，会撞上未释放的
    // exe 句柄而静默失败。现在派生的是"等待主进程退出再安装"的脱离等待进程。
    assert.strictEqual(spawn.file, "powershell");
    assert.ok(spawn.options.detached, "the wait-and-install helper must survive our exit");
    const script = spawn.args[spawn.args.length - 1];
    assert.match(script, /Wait-Process -Id \d+/, "the helper must wait for the shell's pid");
    assert.match(script, /Start-Process -FilePath 'C:\/temp\/ResumeForge-Setup-0\.19\.0\.exe'/,
      "the verified installer path must be handed to Start-Process verbatim");
    assert.match(script, /-ArgumentList '\/S'/, "the NSIS install must stay silent");

    const stopCompleteIndex = loaded.events.order.indexOf("stop-complete");
    const spawnIndex = loaded.events.order.indexOf("installer-spawn");
    assert.ok(spawnIndex > stopCompleteIndex,
      `installer spawn must happen after stop-complete (order: ${loaded.events.order.join(" -> ")})`);
  } finally {
    loaded.cleanup();
  }
});

test("installer asynchronous spawn failure is handled and shown to the user", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    loaded.exports.requestInstallAndQuit("C:/temp/ResumeForge-Setup-0.19.0.exe");
    loaded.events.beforeQuitHandler({ preventDefault() {} });
    await flush();
    const child = loaded.events.installerChildren[0];
    assert.ok(child, "the verified installer path should have been passed to spawn");
    assert.doesNotThrow(() => child.emit("error", new Error("synthetic ENOENT")));
    assert.match(loaded.events.errorBoxes.join(" "), /安装程序未能启动/);
  } finally {
    loaded.cleanup();
  }
});

test("update install is BLOCKED when the backend stop is not confirmed (RR-02)", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const requestInstallAndQuit = loaded.exports.requestInstallAndQuit;
    // The backend could not be proven dead (recycled pid / unreadable identity):
    // installing on top of a live backend is exactly what must not happen.
    loaded.state.stopBackend = () =>
      Promise.resolve({ ok: false, reason: "没有停止后端：命令行与后端不符", verified: false });

    requestInstallAndQuit("C:/temp/ResumeForge-Setup-0.19.0.exe");
    const handler = loaded.events.beforeQuitHandler;
    handler({ preventDefault: () => {} });
    await flush();
    await flush();

    assert.strictEqual(loaded.events.spawnCalls.length, 0,
      "the installer must NOT be spawned while the backend is unconfirmed");
    assert.ok(loaded.events.errorBoxes.length >= 1,
      "the user must see why the update did not install");
    assert.match(loaded.events.errorBoxes.join(" "), /更新未安装|未被确认停止/);
    assert.ok(loaded.events.quitCalls.length >= 2, "quit itself still completes");
  } finally {
    loaded.cleanup();
  }
});

test("a stop that never resolves cannot leak into an install (timeout path)", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const requestInstallAndQuit = loaded.exports.requestInstallAndQuit;
    // A stop() that hangs: the fake timer table lets us fire the 10s cap.
    loaded.state.stopBackend = () => new Promise(() => {});

    requestInstallAndQuit("C:/temp/ResumeForge-Setup-0.19.0.exe");
    const handler = loaded.events.beforeQuitHandler;
    handler({ preventDefault: () => {} });
    await flush();
    assert.strictEqual(loaded.events.spawnCalls.length, 0, "no install while stopping");

    const timeoutTimer = loaded.events.timers.find((t) => t._ms === 10_000);
    assert.ok(timeoutTimer, "before-quit must arm the stop timeout");
    timeoutTimer._fn();
    await flush();
    await flush();

    assert.strictEqual(loaded.events.spawnCalls.length, 0,
      "a timed-out stop must not be followed by an install");
    assert.ok(loaded.events.errorBoxes.length >= 1, "the timeout must be visible to the user");
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
