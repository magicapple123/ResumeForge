"use strict";

// Probes for desktop/updater.js (audit PR-05, 2026-10-13).
//
// updater.js is loaded inside a Node VM with a stubbed electron module and a
// stubbed global fetch -- no real network access happens. Covered:
//   1. fetch init carries an AbortSignal, and timeoutSignal() actually aborts.
//   2. downloadToFile is bounded: Content-Length above the cap aborts without
//      reading the body; a stream that exceeds the cap mid-flight aborts and
//      leaves no partial file behind.
//   3. Full update flow with a mismatching checksum: no installer file is
//      replaced/published and the install step never runs.
//   4. Full update flow with a matching checksum: the verified payload is
//      renamed into place and installAndQuit() receives exactly that path.
//   5. Without an installAndQuit dependency the updater only requests quit --
//      spawning the installer is main.js's job, after the backend stopped.

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const vm = require("vm");
const { test } = require("node:test");

const REPO_DESKTOP = path.join(__dirname, "..");
const RELEASES_API = "https://api.github.com/repos/magicapple123/ResumeForge/releases/latest";

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function sha256Hex(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function loadUpdater({ fetchImpl, appOverrides = {}, dialogResponses = [0, 0], platform = "win32" } = {}) {
  const events = { dialogCalls: [], quitCalls: [], fetchInits: [] };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rf-updater-vm-"));

  const appStub = {
    isPackaged: true,
    getVersion: () => "0.18.0",
    quit: () => events.quitCalls.push("quit"),
    getPath: (name) => tmpRoot,
    ...appOverrides,
  };
  let dialogCallIndex = 0;
  const dialogStub = {
    showMessageBox: async () => {
      events.dialogCalls.push("box");
      const response = dialogResponses[dialogCallIndex] ?? 1;
      dialogCallIndex += 1;
      return { response };
    },
  };

  const sandbox = {
    console,
    process: { ...process, platform },
    Buffer,
    Promise,
    Date,
    JSON,
    Error,
    Math,
    Number,
    String,
    Object,
    Array,
    setTimeout,
    clearTimeout,
    setImmediate,
    AbortSignal,
    URL,
    AbortController,
    fetch: fetchImpl,
    require(spec) {
      if (spec === "electron") {
        return { app: appStub, dialog: dialogStub };
      }
      return require(spec);
    },
    module: { exports: {} },
    __filename: path.join(REPO_DESKTOP, "updater.js"),
    __dirname: REPO_DESKTOP,
  };

  const source = fs.readFileSync(path.join(REPO_DESKTOP, "updater.js"), "utf-8");
  vm.runInNewContext(source, sandbox, { filename: "desktop/updater.js" });
  return { exports: sandbox.module.exports, events, tmpRoot, appStub };
}

function releasePayload(tag) {
  const assetName = `ResumeForge-Setup-${tag.replace(/^v/, "")}.exe`;
  return {
    tag_name: tag,
    assets: [
      { name: assetName, browser_download_url: `https://github.com/magicapple123/ResumeForge/releases/download/${tag}/${assetName}` },
      { name: `${assetName}.sha256`, browser_download_url: `https://github.com/magicapple123/ResumeForge/releases/download/${tag}/${assetName}.sha256` },
    ],
  };
}

function installerResponse(content) {
  // A Node Readable stands in for the real web ReadableStream body: no
  // getReader() -> downloadToFile consumes it as an async iterable of chunks.
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(Buffer.byteLength(content)) },
    body: Readable.from([Buffer.from(content)]),
  };
}

test("fetch init carries an AbortSignal and timeoutSignal() aborts for real", async () => {
  const captured = [];
  const fetchImpl = async (url, init) => {
    captured.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ tag_name: "v0.18.0", assets: [] }),
      body: null,
    };
  };
  const loaded = loadUpdater({ fetchImpl });
  try {
    // Same version -> early return, but the metadata fetch still happened.
    await loaded.exports.checkAndOfferUpdate(null);
    assert.strictEqual(captured.length, 1, "releases API should have been fetched");
    assert.ok(captured[0].init.signal instanceof AbortSignal,
      "fetch must be given an AbortSignal (timeout option alone is not a cancel signal)");

    const signal = loaded.exports.timeoutSignal(20);
    assert.ok(signal instanceof AbortSignal);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.strictEqual(signal.aborted, true, "timeoutSignal must abort after its timeout");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("update metadata requires an exact stable tag and release-asset source", async () => {
  const invalidCases = [
    {
      release: { tag_name: "v0.19.0-beta.1", assets: [] },
      error: /exact stable semver/i,
    },
  ];
  for (const item of invalidCases) {
    const loaded = loadUpdater({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => item.release,
        body: null,
      }),
    });
    try {
      if (item.error) {
        await assert.rejects(() => loaded.exports.checkAndOfferUpdate(null), item.error);
      } else {
        await loaded.exports.checkAndOfferUpdate(null);
        assert.strictEqual(loaded.events.dialogCalls.length, 0, "incomplete release must be skipped");
      }
    } finally {
      fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
    }
  }
});

test("unsupported desktop platforms never fetch or execute the Windows installer", async () => {
  for (const platform of ["darwin", "linux"]) {
    const loaded = loadUpdater({ platform, fetchImpl: async () => assert.fail("no NSIS network on this platform") });
    try {
      await loaded.exports.checkAndOfferUpdate(null, { installAndQuit: () => assert.fail("no NSIS install") });
      assert.strictEqual(loaded.events.dialogCalls.length, 0);
    } finally {
      fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
    }
  }
});

test("download rejects an actual output IO error without waiting forever for drain", async () => {
  const loaded = loadUpdater({ fetchImpl: async () => installerResponse("synthetic installer".repeat(5000)) });
  let watchdog;
  try {
    const download = loaded.exports.downloadToFile("https://github.com/x/fake.exe", path.join(loaded.tmpRoot, "missing", "fake.exe"));
    await assert.rejects(
      Promise.race([download, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("IO watchdog exceeded")), 2000); })]),
      /ENOENT/,
    );
  } finally {
    clearTimeout(watchdog);
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("downloadToFile: Content-Length above the cap aborts without reading the body", async () => {
  let bodyRead = false;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => String(100 * 1024 * 1024) },
    get body() {
      bodyRead = true;
      return (async function* generate() {
        yield Buffer.alloc(1024);
      })();
    },
  });
  const loaded = loadUpdater({ fetchImpl });
  try {
    const dest = path.join(loaded.tmpRoot, "too-big.exe");
    await assert.rejects(
      () => loaded.exports.downloadToFile("https://github.com/x/big.exe", dest, { maxBytes: 1024 }),
      /size limit|too large/i,
    );
    assert.strictEqual(bodyRead, false, "an oversized declared body must not be downloaded");
    assert.strictEqual(fs.existsSync(`${dest}.part`), false, "no partial file may survive");
    assert.strictEqual(fs.existsSync(dest), false, "the destination must not be created");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("downloadToFile: a stream exceeding the cap mid-flight aborts and cleans up", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "40" }, // declared under the cap; reality disagrees
    body: (async function* generate() {
      for (let i = 0; i < 10; i += 1) {
        yield Buffer.alloc(10, 0x41);
      }
    })(),
  });
  const loaded = loadUpdater({ fetchImpl });
  try {
    const dest = path.join(loaded.tmpRoot, "stream-over.exe");
    await assert.rejects(
      () => loaded.exports.downloadToFile("https://github.com/x/s.exe", dest, { maxBytes: 50 }),
      /size limit|exceeded/i,
    );
    assert.strictEqual(fs.existsSync(`${dest}.part`), false, "partial file must be removed on abort");
    assert.strictEqual(fs.existsSync(dest), false);
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("downloadToFile: happy path writes a bounded file and reports its size", async () => {
  const content = "HELLO_INSTALLER_BYTES";
  const fetchImpl = async () => installerResponse(content);
  const loaded = loadUpdater({ fetchImpl });
  try {
    const dest = path.join(loaded.tmpRoot, "ok.exe");
    const result = await loaded.exports.downloadToFile("https://github.com/x/ok.exe", dest, {});
    // The payload lands in the .part staging file; the caller renames only
    // after checksum verification.
    assert.strictEqual(fs.readFileSync(`${dest}.part`, "utf-8"), content);
    assert.strictEqual(result.size, Buffer.byteLength(content));
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("checksum mismatch: no replacement, no install step", async () => {
  const content = "FAKE_INSTALLER_BYTES";
  const fetchImpl = async (url) => {
    if (url === RELEASES_API) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => releasePayload("v0.19.0"),
        body: null,
      };
    }
    if (url.endsWith(".sha256")) {
      return installerResponse("deadbeef  ResumeForge-Setup-0.19.0.exe\n");
    }
    return installerResponse(content);
  };
  const loaded = loadUpdater({ fetchImpl });
  try {
    await assert.rejects(
      () => loaded.exports.checkAndOfferUpdate(null, { installAndQuit: () => {} }),
      /checksum mismatch/i,
    );
    const updateDir = fs.readdirSync(loaded.tmpRoot).find((name) => name.startsWith("resumeforge-update-"));
    const installerPath = path.join(loaded.tmpRoot, updateDir, "ResumeForge-Setup-0.19.0.exe");
    assert.strictEqual(fs.existsSync(installerPath), false,
      "a failed checksum must never replace/publish the installer");
    assert.strictEqual(fs.existsSync(`${installerPath}.part`), false,
      "the rejected payload must be cleaned up");
    assert.strictEqual(loaded.events.dialogCalls.length, 1,
      "the install confirmation must not be shown for a rejected payload");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("checksum match: verified payload is published and installAndQuit gets its path", async () => {
  const content = "FAKE_INSTALLER_BYTES";
  const correctSha = sha256Hex(content);
  const installed = [];
  const fetchImpl = async (url) => {
    if (url === RELEASES_API) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => releasePayload("v0.19.0"),
        body: null,
      };
    }
    if (url.endsWith(".sha256")) {
      return installerResponse(`${correctSha}  ResumeForge-Setup-0.19.0.exe\n`);
    }
    return installerResponse(content);
  };
  const loaded = loadUpdater({ fetchImpl });
  try {
    await loaded.exports.checkAndOfferUpdate(null, {
      installAndQuit: (installerPath) => installed.push(installerPath),
    });
    const installerPath = installed[0];
    assert.strictEqual(installed.length, 1, "installAndQuit must be called exactly once");
    assert.strictEqual(path.basename(installerPath), "ResumeForge-Setup-0.19.0.exe");
    assert.strictEqual(path.dirname(path.dirname(installerPath)), loaded.tmpRoot);
    assert.strictEqual(fs.readFileSync(installerPath, "utf-8"), content,
      "the published installer must contain exactly the verified payload");
    assert.strictEqual(fs.existsSync(`${installerPath}.part`), false,
      "the staging file must be gone after publication");
    assert.strictEqual(loaded.events.quitCalls.length, 0,
      "with an installAndQuit dependency the updater delegates quitting to main.js");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("no installAndQuit dependency: the updater only requests quit (spawn is main's job)", async () => {
  const content = "FAKE_INSTALLER_BYTES";
  const correctSha = sha256Hex(content);
  const fetchImpl = async (url) => {
    if (url === RELEASES_API) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => releasePayload("v0.19.0"),
        body: null,
      };
    }
    if (url.endsWith(".sha256")) {
      return installerResponse(`${correctSha}  ResumeForge-Setup-0.19.0.exe\n`);
    }
    return installerResponse(content);
  };
  const loaded = loadUpdater({ fetchImpl });
  try {
    await loaded.exports.checkAndOfferUpdate(null, {});
    assert.strictEqual(loaded.events.quitCalls.length, 1,
      "fallback path must request app.quit() (before-quit owns stopping + spawning)");
    assert.strictEqual(loaded.events.dialogCalls.length, 2,
      "both confirmations should have been shown on the happy path");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});
