"use strict";

// BackendManager - spawn the backend (uvicorn) and wait until it is healthy.
//
// This mirrors what scripts/Start-ResumeForge.ps1 does for the console flow,
// reduced to what the desktop shell needs: pick a free loopback port, launch
// the venv python with uvicorn, poll /api/health, and shut the process tree
// down cleanly on exit. Console output goes to runtime/logs/desktop-backend.log
// so no console window is ever involved.
//
// ADR-0004 (data directory policy): when the shell hands us a user data dir,
// the backend runs with RF_DATA_DIR pointing at it, so the database,
// attachments, exports and backups land under the user profile instead of the
// (possibly read-only) install payload.

const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const processIdentity = require("./lib/process-identity");
const { attachBackendChild } = require("./lib/backend-startup");
const { BACKEND_COMMAND_PATTERNS: BACKEND_COMMAND_PATTERNS_FOR_RECORDS, stopBackend } = require("./lib/backend-stop");
const {
  RUNTIME_ZIP_NAME,
  extractZip,
  isRuntimeMarkerValid,
  resolvePython,
  resolveRuntimePython,
  rotateLogFile,
  runtimeMarkerDigest,
  runtimeMarkerPath,
} = require("./lib/backend-runtime");

const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 300;
const PORT_SCAN_START = 8010;
const PORT_SCAN_END = 8099;
// The fallback launcher (Start-ResumeForge.ps1 / start.sh) records the real
// backend process here before it exits. Windows writes JSON (backend.json),
// macOS a flat key=value file (backend.macos.pid) -- same information, two
// shapes (scripts/macos/lib/common.sh), so both are read (RR-02).
const ADOPTED_PID_RELATIVE_PATH = path.join("runtime", "backend.json");
const ADOPTED_PID_MACOS_RELATIVE_PATH = path.join("runtime", "backend.macos.pid");

// How long to wait for a process we asked to stop to actually disappear before
// reporting the stop as unconfirmed.
const EXIT_CONFIRM_TIMEOUT_MS = 5000;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// --- ADR-0004: user data directory --------------------------------------------

// Build the extra environment for the backend process. The backend's config
// (backend/app/config.py) resolves its data directory from RF_DATA_DIR when
// set, so the database/attachments/exports follow the user profile instead of
// the install payload.
function buildBackendEnv(userDataDir) {
  return userDataDir ? { RF_DATA_DIR: userDataDir } : {};
}

// --- runtime marker versioning (audit PR-05) -----------------------------------

class BackendManager {
  constructor(projectRoot, runtimeDir, {
    packaged = false,
    userDataDir = null,
    extractFn = extractZip,
    spawnFn = spawn,
    execFileFn,
    verifyProcessFn = processIdentity.verifyProcessRecord,
    exitConfirmTimeoutMs = EXIT_CONFIRM_TIMEOUT_MS,
    processExistsFn = processIdentity.processExists,
    killFn = null,
  } = {}) {
    this.projectRoot = projectRoot;
    this.runtimeDir = runtimeDir;
    this.packaged = packaged;
    this.userDataDir = userDataDir;
    this.extractFn = extractFn;
    this.spawnFn = spawnFn;
    // Identity probes (RR-02) are injectable so the offline tests can drive a
    // fake process table instead of the real one; the confirmation budget is
    // injectable so a "surviving process" probe does not have to wait it out.
    this.execFileFn = execFileFn;
    this.verifyProcessFn = verifyProcessFn;
    this.exitConfirmTimeoutMs = exitConfirmTimeoutMs;
    // Existence probe for "did it actually exit": injectable so tests can
    // script a surviving process without touching the real process table.
    this.processExistsFn = processExistsFn;
    // POSIX kill injectable for the same reason (null = real process.kill).
    this.killFn = killFn;
    this.child = null;
    this.logStream = null;
    this.stopped = false;
    // Launcher mode: the child is the shipped bootstrap script, which exits
    // after starting the real backend (handoff), not a crash.
    this.usingLauncher = false;
    // Set once the real backend process is identified after a launcher
    // handoff, so stop() can terminate the actual tree. The record carries the
    // identity evidence; the bare pid is kept for logs/tests.
    this.adoptedPid = null;
    this.adoptedRecord = null;
    this.url = null;
    this.earlyExit = null;
    // Outcome of the last stop(): { ok, reason, verified }. The shell reads it
    // before letting an update installer overwrite this installation.
    this.lastStop = null;
    // Set by the shell: called when the backend dies while we did not ask
    // it to (crash supervision hook).
    this.onUnexpectedExit = null;
  }

  logFile() {
    return path.join(this.projectRoot, "runtime", "logs", "desktop-backend.log");
  }

  adoptedPidFile() {
    return path.join(this.projectRoot, ADOPTED_PID_RELATIVE_PATH);
  }

  adoptedPidMacosFile() {
    return path.join(this.projectRoot, ADOPTED_PID_MACOS_RELATIVE_PATH);
  }

  // The console launchers record the real backend process as
  // {process_id, started_at_unix, started_at} (scripts/ResumeForge.Common.ps1);
  // macOS writes the same fields flat plus start_signature
  // (scripts/macos/lib/common.sh). Both shapes resolve to one record.
  readAdoptedRecord() {
    const candidates =
      process.platform === "darwin"
        ? [this.adoptedPidMacosFile(), this.adoptedPidFile()]
        : [this.adoptedPidFile(), this.adoptedPidMacosFile()];
    for (const candidate of candidates) {
      try {
        const record = processIdentity.parseProcessRecord(fs.readFileSync(candidate, "utf-8"));
        if (record) return record;
      } catch {
        // Missing/unreadable record: try the next shape.
      }
    }
    return null;
  }

  readAdoptedPid() {
    const record = this.readAdoptedRecord();
    return record ? record.pid : null;
  }

  // Snapshot the identity of the backend this shell spawned itself and record
  // it in the same format the console launcher uses (RR-02: identity is
  // recorded on both legs of the handoff). Best effort: a record we cannot
  // fill with a read start time is worse than no record, so it is skipped.
  async recordSpawnedChild(pid) {
    const info = await processIdentity.readProcessInfo(pid, { execFileFn: this.execFileFn });
    if (!info || typeof info !== "object") return;
    // The snapshot is ours regardless of what the shared record file says: it
    // is what stop() re-checks before killing this child.
    this.childIdentity = info;
    // The record file is shared with the console launcher (start.cmd): if it
    // currently describes a DIFFERENT live backend, leave it alone -- the
    // desktop shell must not shadow a running console session's record, or
    // stop.cmd would later find a dead pid and report "not running".
    if (await this.recordHoldsForeignLiveBackend(pid)) return;
    if (!Number.isInteger(info.startedAtUnix) || info.startedAtUnix <= 0) return;
    try {
      const recordPath = this.adoptedPidFile();
      fs.mkdirSync(path.dirname(recordPath), { recursive: true });
      fs.writeFileSync(
        recordPath,
        JSON.stringify({
          process_id: pid,
          started_at_unix: info.startedAtUnix,
          started_at: new Date(info.startedAtUnix * 1000).toISOString(),
          recorded_by: "desktop-shell",
        }),
      );
    } catch {
      // Recording is diagnostic; never block a launch on it.
    }
  }

  // Packaged mode reuses the shipped launchers (python/node bootstrap, venv,
  // uvicorn, health) instead of duplicating that logic in Node: hidden
  // window, pinned port, no browser.
  launcherCommand(port) {
    if (process.platform === "win32") {
      return {
        file: "powershell.exe",
        args: [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(this.projectRoot, "scripts", "Start-ResumeForge.ps1"),
          "-BackendPort",
          String(port),
          "-NoBrowser",
        ],
        cwd: this.projectRoot,
      };
    }
    return {
      file: "/bin/bash",
      args: [
        path.join(this.projectRoot, "scripts", "macos", "start.sh"),
        "--backend-port",
        String(port),
        "--no-browser",
      ],
      cwd: this.projectRoot,
    };
  }

  async prepareRuntime(onStage) {
    // Dev tree: desktop/python-runtime.zip. Packaged: copied to the payload
    // root by scripts/Build-Desktop.ps1.
    const zipPath = path.join(
      this.projectRoot,
      this.packaged ? RUNTIME_ZIP_NAME : path.join("desktop", RUNTIME_ZIP_NAME),
    );
    if (!fs.existsSync(zipPath)) {
      return;
    }
    const python = resolveRuntimePython(this.runtimeDir);
    if (fs.existsSync(python) && (await isRuntimeMarkerValid(this.runtimeDir, zipPath))) {
      return;
    }

    if (onStage) onStage("preparing-runtime");
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    // Remove the stale marker first: a crash mid-extraction must never leave
    // a "complete" marker pointing at a half-installed runtime.
    fs.rmSync(runtimeMarkerPath(this.runtimeDir), { force: true });
    await this.extractFn(zipPath, this.runtimeDir);
    if (!fs.existsSync(python)) {
      throw new Error(
        `Runtime unpacked but interpreter missing: ${python} (zip layout mismatch?)`,
      );
    }
    fs.writeFileSync(
      runtimeMarkerPath(this.runtimeDir),
      JSON.stringify({
        sha256: await runtimeMarkerDigest(zipPath),
        createdAt: new Date().toISOString(),
      }),
    );
  }

  async start(onStage) {
    // A fresh launch supersedes an earlier stop (crash-restart path).
    this.stopped = false;
    this.lastStop = null;
    await this.prepareRuntime(onStage);
    const port = await findFreePort();
    const logPath = this.logFile();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    rotateLogFile(logPath);
    this.logStream = fs.createWriteStream(logPath, { flags: "a" });
    this.logStream.write(`\n==== desktop launch ${new Date().toISOString()} port=${port} ====\n`);

    if (onStage) onStage("backend-starting");

    // ADR-0004: bundled/launcher backends run against the user data dir.
    const childEnv = { ...process.env, ...buildBackendEnv(this.userDataDir) };

    const bundled = resolveRuntimePython(this.runtimeDir);
    this.usingLauncher = false;
    if (fs.existsSync(bundled)) {
      // Preferred: the bundled runtime is a complete env (interpreter +
      // site-packages), so uvicorn starts directly with no provisioning.
      this.child = this.spawnFn(
        bundled,
        [
          "-m",
          "uvicorn",
          "app.main:app",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--log-level",
          "warning",
        ],
        {
          cwd: path.join(this.projectRoot, "backend"),
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: childEnv,
        },
      );
    } else if (this.packaged) {
      // Fallback: defer to the shipped launcher (python/node bootstrap, venv,
      // dependency install). Hidden window, pinned port. Slow on first run -
      // the bundled runtime exists precisely to avoid this path.
      this.usingLauncher = true;
      const launcher = this.launcherCommand(port);
      this.child = this.spawnFn(launcher.file, launcher.args, {
        cwd: launcher.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });
    } else {
      const venvPython = resolvePython(this.projectRoot);
      this.child = this.spawnFn(
        venvPython,
        [
          "-m",
          "uvicorn",
          "app.main:app",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--log-level",
          "warning",
        ],
        {
          cwd: path.join(this.projectRoot, "backend"),
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: childEnv,
        },
      );
    }
    attachBackendChild(this);

    const url = `http://127.0.0.1:${port}`;
    this.url = url;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    if (onStage) onStage("health-check");
    while (Date.now() < deadline) {
      if (this.startupError) {
        this.closeLog();
        throw new Error(`Backend spawn failed: ${this.startupError.message}. See ${logPath}`);
      }
      if (this.earlyExit && !this.usingLauncher) {
        throw new Error(
          `Backend exited early (code=${this.earlyExit.code}). See ${logPath}`,
        );
      }
      if (this.stopped) throw new Error("Backend startup aborted");
      if (await this.isHealthy(url)) {
        if (this.usingLauncher) {
          // The launcher may already have handed off; adopt (or refresh) the
          // record it wrote for the real backend process.
          this.adoptRecordedBackend();
        }
        if (onStage) onStage("ready");
        return url;
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
    }
    // Health deadline blown: never leave a half-started tree behind. Try to
    // stop whatever we spawned (the caller's stop() would otherwise miss a
    // child that never reported healthy), then report the failure.
    try {
      await this.stop();
    } catch {
      // Stopping is best effort on the failure path; the timeout below is the
      // error the user sees.
    }
    throw new Error(`Backend health check timed out. See ${logPath}`);
  }

  // Health probe: /api/health must answer 200 within 2s. Kept on the class
  // (the offline suites override it); the split that moved the stop logic out
  // must never take this with it -- start() and onChildExit() both rely on it.
  async isHealthy(url) {
    try {
      const response = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // Stop the backend and report whether it is really gone. The decision logic
  // (identity re-verification, tree kill, exit confirmation) lives in
  // lib/backend-stop.js; this only owns the manager's own state and log handle.
  // Resolves to { ok, reason, verified }: the shell must not treat "we asked it
  // to die" as "it is dead" (RR-02).
  async stop() {
    this.stopped = true;
    let outcome;
    try {
      outcome = await stopBackend(this);
    } finally {
      this.closeLog();
    }
    this.lastStop = outcome;
    return outcome;
  }

  // Supervision decision for a child exit. In launcher mode the child is a
  // short-lived bootstrap script whose normal exit is a handoff: once the
  // backend URL is known, the health probe (and the health deadline in
  // start()) decides success or failure -- never the launcher's own exit.
  onChildExit(code, signal) {
    this.earlyExit = { code, signal };
    if (this.stopped) return;
    if (!this.usingLauncher) {
      if (this.onUnexpectedExit) this.onUnexpectedExit({ code, signal });
      return;
    }
    if (!this.url) {
      // The launcher died before the health loop even started probing.
      if (this.onUnexpectedExit) this.onUnexpectedExit({ code, signal });
      return;
    }
    setImmediate(() => {
      this.isHealthy(this.url)
        .then((healthy) => {
          if (this.stopped) return;
          if (healthy) {
            this.adoptRecordedBackend();
            // Handoff complete: the real backend keeps running; no crash.
            return;
          }
          // Not healthy yet: the backend may still be booting under the
          // launcher's work. start()'s health deadline owns the verdict.
        })
        .catch(() => {});
    });
  }

  // Does the shared record already describe a live backend that is not ours?
  async recordHoldsForeignLiveBackend(pid) {
    const existing = this.readAdoptedRecord();
    if (!existing || existing.pid === pid) return false;
    const verdict = await this.verifyProcessFn(existing, {
      commandPatterns: BACKEND_COMMAND_PATTERNS_FOR_RECORDS,
      execFileFn: this.execFileFn,
    });
    return verdict.status === processIdentity.STATUS_VERIFIED;
  }

  // Adopt the backend that a launcher handed off (or that we spawned): the pid
  // AND the evidence needed to re-verify it before any kill. Re-read on every
  // health success so a crash-restart replaces the stale record instead of
  // carrying the previous pid forward (RR-02).
  adoptRecordedBackend() {
    const record = this.readAdoptedRecord();
    if (!record) return;
    this.adoptedRecord = record;
    this.adoptedPid = record.pid;
  }

  closeLog() {
    if (this.logStream) {
      const stream = this.logStream;
      this.logStream = null;
      // Log IO must never take the shell down (same discipline as the shell's
      // own logLine): a failed flush on a removed/locked file is swallowed.
      stream.on("error", () => {});
      if (stream.pending) {
        // Still opening: destroy cancels the open. end() would wait for the
        // pending open and race a temp-dir cleanup (post-test ENOENT under
        // node --test).
        stream.destroy();
      } else {
        stream.end();
      }
    }
  }
}

module.exports = {
  BackendManager,
  buildBackendEnv,
  // Runtime helpers live in lib/backend-runtime.js; re-exported here so the
  // existing callers/tests keep their import path.
  rotateLogFile,
  runtimeMarkerPath,
  runtimeMarkerDigest,
  isRuntimeMarkerValid,
};
