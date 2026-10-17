"use strict";

// Probes for the preload quitApp bridge (desktop/preload.js + desktop/main.js).
//
// The frontend's exit button (frontend/src/components/common/ExitAppButton.tsx)
// calls window.splash.quitApp() -> ipcRenderer.send("app:quit-request"). The
// contract under test: main.js maps that channel to app.quit() ONLY -- the
// backend stop stays in before-quit, the single stop point (audit PR-05).
// Shared VM harness lives in lifecycle-harness.js.
//
// Run with: node scripts/test-quit-bridge.js   (or: node --test scripts/)

const assert = require("assert");
const { test } = require("node:test");
const { flush, loadMain, makeDeferred, waitForShellReady } = require("./lifecycle-harness");

test("preload quitApp bridge (app:quit-request) funnels into app.quit() and the stop flow", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    // preload.js exposes quitApp() -> ipcRenderer.send("app:quit-request");
    // main.js must map it to app.quit() only -- no second stop path.
    const handler = loaded.events.quitRequestHandler;
    assert.strictEqual(typeof handler, "function",
      "main.js must register the app:quit-request channel");

    handler();
    assert.ok(loaded.events.quitCalls.length >= 1, "the bridge must request app.quit()");
    assert.strictEqual(loaded.events.stopCalls.length, 0,
      "the bridge itself must not stop the backend directly");

    // The quit flows through before-quit: backend stops exactly once there.
    loaded.events.beforeQuitHandler({ preventDefault() {} });
    await flush();
    assert.strictEqual(loaded.events.stopCalls.length, 1,
      "quit via the bridge must stop the backend via before-quit (single stop point)");
  } finally {
    loaded.cleanup();
  }
});

test("quit via the bridge keeps the ordering: stop completes before quit resumes", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const deferred = makeDeferred();
    loaded.state.stopBackend = () => deferred.promise;

    const handler = loaded.events.quitRequestHandler;
    handler();
    const quitsBeforeStop = loaded.events.quitCalls.length;
    loaded.events.beforeQuitHandler({ preventDefault() {} });

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
  } finally {
    loaded.cleanup();
  }
});
