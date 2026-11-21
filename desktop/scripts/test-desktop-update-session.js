// SPDX-License-Identifier: Apache-2.0
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDesktopUpdateSession: createSession } = require("../lib/desktop-update-session");
const { registerDesktopShellIpc } = require("../lib/desktop-shell-ipc");
const { loadUpdater } = require("./updater-sandbox");

test("a manual check joins startup and one user confirmation installs the offered version", async () => {
  assert.equal(typeof createSession, "function", "packaged Windows needs one in-app update session");
  const events = [];
  const offer = { current: "2.2.2", latest: "2.2.3", notes: "Notes", size: 100, installer: {}, checksum: {} };
  let checks = 0;
  let installs = 0;
  let resolveOffer;
  let finishInstall;
  const session = createSession({
    current: offer.current,
    publish: state => events.push(state),
    inspect: () => { checks++; return new Promise(resolve => { resolveOffer = resolve; }); },
    install: async (approved, report) => {
      assert.equal(approved, offer);
      installs++;
      report({ phase: "downloading", received: 50, total: 100 });
      await new Promise(resolve => { finishInstall = resolve; });
      report({ phase: "verifying" });
      report({ phase: "installing" });
    },
  });
  const startup = session.check(false);
  const manual = session.check(true);
  await Promise.resolve();
  resolveOffer(offer);
  await Promise.all([startup, manual]);
  assert.equal(checks, 1);
  assert.equal(session.snapshot().manual, true);
  assert.equal(session.snapshot().phase, "available");
  assert.equal(session.start("2.9.9"), false, "never replace the release the user approved");
  assert.equal(session.start(offer.latest), true);
  assert.equal(session.start(offer.latest), false);
  await session.check(true);
  assert.equal(session.snapshot().received, 50);
  finishInstall();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(installs, 1);
  assert.ok(events.some(s => s.phase === "verifying"));
  assert.equal(session.snapshot().phase, "installing");
});

test("manual checks recover from missing assets and network errors without installing", async () => {
  const results = [new Error("offline"), { latest: "2.2.3", missing: "Setup.exe.sha256" },
    { latest: "2.2.2", upToDate: true }];
  const session = createSession({
    current: "2.2.2", publish() {},
    inspect: async () => {
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result;
    },
    install: assert.fail,
  });
  await session.check(false);
  assert.equal(session.snapshot().error, "check");
  assert.equal(session.snapshot().manual, false);
  await session.check(true);
  assert.equal(session.snapshot().error, "incomplete");
  assert.equal(session.start("2.2.3"), false);
  await session.check(true);
  assert.equal(session.snapshot().phase, "current");
  session.interrupted("2.2.3");
  assert.equal(session.snapshot().error, "interrupted");
  assert.equal(session.start("2.2.3"), false);
});

test("only the app's top-level frame can authorize the displayed release", () => {
  const handlers = new Map();
  const frame = { url: "http://127.0.0.1:4189/settings?tab=about" };
  const contents = { mainFrame: frame };
  const win = { isDestroyed: () => false, webContents: contents };
  let starts = 0;
  registerDesktopShellIpc({
    getWindow: () => win, getBackendUrl: () => "http://127.0.0.1:4189",
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), on() {} },
    app: {}, shell: {}, titleBar: {}, updateSession: { start: () => ++starts > 0 },
  });
  const start = handlers.get("desktop:start-update");
  assert.equal(start({sender: contents, senderFrame: { ...frame }}, "2.2.3"), false);
  frame.url = "http://127.0.0.1:9789";
  assert.equal(start({sender: contents, senderFrame: frame}, "2.2.3"), false);
  frame.url = "http://127.0.0.1:4189/settings";
  assert.equal(start({sender: contents, senderFrame: frame}, "2.2.3"), true);
  assert.equal(starts, 1);
});

test("the shell dispatches PowerShell through a detached Windows command host", () => {
  const updater = loadUpdater({ module: { exports: {} }, Buffer, process }, {});
  const installer = "C:/Alice & Bob/100%/it's ready/ResumeForge-Setup-2.2.3.exe";
  const {file, args} = updater.installerWaitCommand(installer, 42);
  assert.match(file, /[\\/]System32[\\/]cmd\.exe$/i);
  assert.equal(args.includes("/d"), true);
  assert.equal(args.includes(installer), false);
  const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
  assert.match(script, /Wait-Process -Id 42/);
  assert.ok(script.includes("Start-Process -FilePath 'C:/Alice & Bob/100%/it''s ready/ResumeForge-Setup-2.2.3.exe'"));
  assert.match(script, /\/S --force-run/);
  assert.match(script, /\.WaitForExit\(\)/);
  assert.match(script, /'2\.2\.3','2\.2\.3\.0'/);
  assert.ok(script.includes(process.execPath.replace(/'/g, "''")));
});
