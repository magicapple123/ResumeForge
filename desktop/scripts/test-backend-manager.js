"use strict";

// Probes for desktop/backend-manager.js (audit PR-05, 2026-10-13).
//
// Pure helpers are tested directly; process-related paths are tested through
// injected extractFn/spawnFn fakes and overridden isHealthy -- no real child
// process, no network. Covered:
//   1. buildBackendEnv: the user-data directory reaches the backend as
//      RF_DATA_DIR (ADR-0004); without it the env is untouched.
//   2. Runtime marker versioning: a marker whose digest does not match the
//      shipped zip (or an old unversioned marker) triggers re-extraction; a
//      matching marker skips it.
//   3. Launcher supervision: the fallback bootstrap script's normal exit once
//      the backend is healthy is a handoff, NOT a crash; the real backend pid
//      is adopted from runtime/backend.json for later stop().
//   4. stop() with an adopted pid kills the real backend tree.
//   5. start() passes the RF_DATA_DIR env to the spawned backend.
//   6. rotateLogFile keeps the desktop backend log bounded.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");

const {
  BackendManager,
  buildBackendEnv,
  rotateLogFile,
  runtimeMarkerPath,
  runtimeMarkerDigest,
  isRuntimeMarkerValid,
} = require("../backend-manager");

function makeTempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rf-backend-manager-${label}-`));
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const IS_WIN = process.platform === "win32";
const PYTHON_REL = IS_WIN ? path.join("python", "python.exe") : path.join("python", "bin", "python3");

function writeBundledPython(runtimeDir) {
  fs.mkdirSync(path.join(runtimeDir, path.dirname(PYTHON_REL)), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, PYTHON_REL), "py");
}

// --- 1. buildBackendEnv -------------------------------------------------------

test("buildBackendEnv maps the user data dir to RF_DATA_DIR (ADR-0004)", () => {
  assert.deepStrictEqual(buildBackendEnv(null), {}, "no user data dir -> no env additions");
  assert.deepStrictEqual(buildBackendEnv("D:/userdata/ResumeForge/data"), {
    RF_DATA_DIR: "D:/userdata/ResumeForge/data",
  });
});

// --- 2. runtime marker versioning ---------------------------------------------

test("runtime marker: missing, stale or mismatched markers are invalid", async () => {
  const root = makeTempRoot("marker-invalid");
  try {
    const zipPath = path.join(root, "python-runtime.zip");
    fs.writeFileSync(zipPath, "zip-bytes-v1");
    const runtimeDir = path.join(root, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });

    assert.strictEqual(await isRuntimeMarkerValid(runtimeDir, zipPath), false,
      "missing marker -> invalid");

    // Old-format marker (plain ISO text, pre-versioning builds).
    fs.writeFileSync(runtimeMarkerPath(runtimeDir), new Date().toISOString());
    assert.strictEqual(await isRuntimeMarkerValid(runtimeDir, zipPath), false,
      "unversioned (legacy) marker -> must not be trusted");

    // Versioned marker with the wrong digest (runtime changed under it).
    fs.writeFileSync(
      runtimeMarkerPath(runtimeDir),
      JSON.stringify({ sha256: "0".repeat(64), createdAt: new Date().toISOString() }),
    );
    assert.strictEqual(await isRuntimeMarkerValid(runtimeDir, zipPath), false,
      "digest mismatch -> invalid");

    // Correct digest -> valid.
    const digest = await runtimeMarkerDigest(zipPath);
    fs.writeFileSync(
      runtimeMarkerPath(runtimeDir),
      JSON.stringify({ sha256: digest, createdAt: new Date().toISOString() }),
    );
    assert.strictEqual(await isRuntimeMarkerValid(runtimeDir, zipPath), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("prepareRuntime: marker mismatch triggers re-extraction; matching marker skips it", async () => {
  const root = makeTempRoot("marker-reextract");
  try {
    const zipPath = path.join(root, "desktop", "python-runtime.zip");
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    fs.writeFileSync(zipPath, "zip-bytes-v1");
    const runtimeDir = path.join(root, "runtime");

    const extractCalls = [];
    const extractFn = async (zip, target) => {
      extractCalls.push({ zip, target });
      writeBundledPython(target);
    };

    const manager = new BackendManager(root, runtimeDir, { packaged: false, extractFn });

    // Stale legacy marker (plain text) must not prevent the fresh install.
    fs.mkdirSync(runtimeDir, { recursive: true });
    writeBundledPython(runtimeDir);
    fs.writeFileSync(runtimeMarkerPath(runtimeDir), "2025-01-01T00:00:00.000Z");

    await manager.prepareRuntime(() => {});
    assert.strictEqual(extractCalls.length, 1, "stale marker must trigger re-extraction");
    const marker = JSON.parse(fs.readFileSync(runtimeMarkerPath(runtimeDir), "utf-8"));
    assert.strictEqual(marker.sha256, await runtimeMarkerDigest(zipPath),
      "the new marker must record the shipped zip's digest");

    // Second start with an unchanged runtime: no re-extraction.
    await manager.prepareRuntime(() => {});
    assert.strictEqual(extractCalls.length, 1, "valid marker must skip extraction");

    // Simulate a dependency upgrade: the zip payload changed.
    fs.writeFileSync(zipPath, "zip-bytes-v2");
    await manager.prepareRuntime(() => {});
    assert.strictEqual(extractCalls.length, 2,
      "a changed runtime zip must invalidate the marker and reinstall");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 3. launcher supervision ---------------------------------------------------

function makeManager(root, overrides = {}) {
  const manager = new BackendManager(root, path.join(root, "runtime"), {
    packaged: true,
    ...overrides,
  });
  return manager;
}

test("launcher normal exit with a healthy backend is a handoff, not a crash", async () => {
  const root = makeTempRoot("launcher-adopt");
  try {
    const manager = makeManager(root);
    manager.usingLauncher = true;
    manager.url = "http://127.0.0.1:8055";
    manager.isHealthy = async () => true;
    let unexpected = 0;
    manager.onUnexpectedExit = () => {
      unexpected += 1;
    };

    // The launcher wrote the real backend's pid record before exiting.
    fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "runtime", "backend.json"),
      JSON.stringify({ process_id: 4321, started_at: "2026-10-13T00:00:00Z" }),
    );

    manager.onChildExit(0, null);
    await flush();
    await flush();

    assert.strictEqual(unexpected, 0,
      "the bootstrap script exiting normally must not be reported as a crash");
    assert.strictEqual(manager.adoptedPid, 4321,
      "the real backend pid should be adopted from runtime/backend.json");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("launcher exit before any health signal is treated as an unexpected exit", async () => {
  const root = makeTempRoot("launcher-early");
  try {
    const manager = makeManager(root);
    manager.usingLauncher = true;
    manager.url = null; // health loop never got to probe
    let unexpected = 0;
    manager.onUnexpectedExit = () => {
      unexpected += 1;
    };

    manager.onChildExit(1, null);
    await flush();
    assert.strictEqual(unexpected, 1,
      "a launcher dying before the backend ever became healthy is a crash");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("non-launcher child exit still reports a crash", async () => {
  const root = makeTempRoot("bundled-crash");
  try {
    const manager = makeManager(root);
    manager.usingLauncher = false;
    let unexpected = 0;
    manager.onUnexpectedExit = () => {
      unexpected += 1;
    };
    manager.onChildExit(1, null);
    await flush();
    assert.strictEqual(unexpected, 1,
      "bundled-python backend exit must keep triggering crash supervision");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 4. stop() with an adopted pid ---------------------------------------------

test("stop() kills the adopted backend tree when the launcher already exited", async () => {
  const root = makeTempRoot("stop-adopted");
  try {
    const spawnCalls = [];
    const spawnFn = (file, args, options) => {
      spawnCalls.push({ file, args, options });
      return { on(event, cb) { if (event === "exit") setTimeout(cb, 0); } };
    };
    const manager = makeManager(root, { spawnFn });
    manager.adoptedPid = 4321;
    manager.child = { exitCode: 0, signalCode: null, pid: 999 }; // launcher already gone
    manager.onUnexpectedExit = () => {
      throw new Error("stop must not trigger crash supervision");
    };

    await manager.stop();
    assert.strictEqual(spawnCalls.length, 1, "the adopted tree must be terminated");
    if (IS_WIN) {
      assert.strictEqual(spawnCalls[0].file, "taskkill");
      assert.deepStrictEqual(spawnCalls[0].args, ["/pid", "4321", "/T", "/F"]);
    }
    assert.strictEqual(manager.logStream, null, "the log handle must be closed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 5. start() passes the user-data env ---------------------------------------

test("start() spawns the backend with RF_DATA_DIR pointing at the user data dir", async () => {
  const root = makeTempRoot("start-env");
  try {
    const runtimeDir = path.join(root, "runtime");
    writeBundledPython(runtimeDir); // bundled branch

    const spawnCalls = [];
    const spawnFn = (file, args, options) => {
      spawnCalls.push({ file, args, options });
      return {
        pid: 1234,
        exitCode: null,
        signalCode: null,
        stdout: { on() {} },
        stderr: { on() {} },
        on() {},
        kill() {},
      };
    };
    const manager = new BackendManager(root, runtimeDir, {
      packaged: false,
      userDataDir: path.join(root, "userdata"),
      spawnFn,
    });
    manager.isHealthy = async () => true; // healthy immediately

    const url = await manager.start(() => {});
    assert.ok(url.startsWith("http://127.0.0.1:"), "start should return the backend url");
    assert.strictEqual(spawnCalls.length, 1);
    assert.strictEqual(
      spawnCalls[0].options.env.RF_DATA_DIR,
      path.join(root, "userdata"),
      "the backend env must point RF_DATA_DIR at the user data directory",
    );
    assert.ok(spawnCalls[0].options.env.PATH, "the parent env must be inherited");
    // Close the log handle BEFORE the temp root is deleted, otherwise the
    // stream's async close fires after cleanup (fails under node --test).
    manager.closeLog();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 6. log rotation ------------------------------------------------------------

test("rotateLogFile keeps the backend log bounded (single .old generation)", () => {
  const root = makeTempRoot("log-rotate");
  try {
    const logPath = path.join(root, "desktop-backend.log");
    fs.writeFileSync(logPath, "x".repeat(40));

    rotateLogFile(logPath, 20);
    assert.strictEqual(fs.existsSync(logPath), false, "an oversized log must be rotated away");
    assert.strictEqual(fs.readFileSync(`${logPath}.old`, "utf-8").length, 40);

    // Next rotation replaces the previous .old instead of accumulating.
    fs.writeFileSync(logPath, "y".repeat(40));
    rotateLogFile(logPath, 20);
    assert.strictEqual(fs.readFileSync(`${logPath}.old`, "utf-8"), "y".repeat(40));

    // A small log is left alone.
    fs.writeFileSync(logPath, "tiny");
    rotateLogFile(logPath, 20);
    assert.strictEqual(fs.readFileSync(logPath, "utf-8"), "tiny");
    assert.strictEqual(fs.readFileSync(`${logPath}.old`, "utf-8"), "y".repeat(40));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
