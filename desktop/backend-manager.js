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

const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 300;
const PORT_SCAN_START = 8010;
const PORT_SCAN_END = 8099;
// Release archives may carry a zipped Python runtime (phase 3 packaging).
// When present it is unpacked once into the shared data dir and preferred
// over the dev-tree venv; dev trees simply keep using the venv.
const RUNTIME_ZIP_NAME = "python-runtime.zip";
// The backend log is appended on every launch and every restart; without a
// cap a long-lived install accumulates gigabytes. One previous generation is
// kept for post-mortems.
const LOG_MAX_BYTES = 5 * 1024 * 1024;
// The fallback launcher (Start-ResumeForge.ps1 / start.sh) records the real
// backend process here before it exits.
const ADOPTED_PID_RELATIVE_PATH = path.join("runtime", "backend.json");

function resolveRuntimePython(runtimeDir) {
  return process.platform === "win32"
    ? path.join(runtimeDir, "python", "python.exe")
    : path.join(runtimeDir, "python", "bin", "python3");
}

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

function resolvePython(projectRoot) {
  const candidates =
    process.platform === "win32"
      ? [path.join(projectRoot, "backend", ".venv", "Scripts", "python.exe")]
      : [path.join(projectRoot, "backend", ".venv", "bin", "python")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Python interpreter not found: ${candidates[0]}`);
}

function extractZip(zipPath, targetDir) {
  // bsdtar ships with Windows 10+ and macOS and reads zip archives fine;
  // using it avoids shipping an unzip dependency in the shell.
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xf", zipPath, "-C", targetDir], {
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`tar exited with ${code} while unpacking runtime`)),
    );
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

function runtimeMarkerPath(runtimeDir) {
  return path.join(runtimeDir, ".runtime-complete");
}

// The marker records the sha256 of the zip it was installed from. A marker
// whose digest no longer matches the shipped zip means the packaged runtime
// changed (dependency upgrade, interpreter bump) and the previously unpacked
// tree must NOT be silently reused.
function runtimeMarkerDigest(zipPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(zipPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function isRuntimeMarkerValid(runtimeDir, zipPath) {
  const markerPath = runtimeMarkerPath(runtimeDir);
  if (!fs.existsSync(markerPath)) return false;
  let expected;
  try {
    expected = await runtimeMarkerDigest(zipPath);
  } catch {
    return false;
  }
  let recorded = "";
  try {
    recorded = String(JSON.parse(fs.readFileSync(markerPath, "utf-8")).sha256 || "");
  } catch {
    // Legacy plain-text markers (pre-versioning) fail the parse and are
    // treated as stale.
    return false;
  }
  return recorded === expected;
}

// --- log rotation (audit PR-05) -------------------------------------------------

function rotateLogFile(logPath, maxBytes = LOG_MAX_BYTES) {
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > maxBytes) {
      fs.rmSync(`${logPath}.old`, { force: true });
      fs.renameSync(logPath, `${logPath}.old`);
    }
  } catch {
    // Rotation is best effort; never block the launch on it.
  }
}

class BackendManager {
  constructor(projectRoot, runtimeDir, { packaged = false, userDataDir = null, extractFn = extractZip, spawnFn = spawn } = {}) {
    this.projectRoot = projectRoot;
    this.runtimeDir = runtimeDir;
    this.packaged = packaged;
    this.userDataDir = userDataDir;
    this.extractFn = extractFn;
    this.spawnFn = spawnFn;
    this.child = null;
    this.logStream = null;
    this.stopped = false;
    // Launcher mode: the child is the shipped bootstrap script, which exits
    // after starting the real backend (handoff), not a crash.
    this.usingLauncher = false;
    // Set once the real backend process is identified after a launcher
    // handoff, so stop() can terminate the actual tree.
    this.adoptedPid = null;
    this.url = null;
    this.earlyExit = null;
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

  // The console launchers record the real backend process as
  // {process_id, started_at_unix, started_at} (scripts/ResumeForge.Common.ps1).
  readAdoptedPid() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.adoptedPidFile(), "utf-8"));
      const pid = Number(parsed.process_id);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
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
    this.child.stdout.on("data", (chunk) => this.logStream.write(chunk));
    this.child.stderr.on("data", (chunk) => this.logStream.write(chunk));

    this.earlyExit = null;
    this.child.on("exit", (code, signal) => this.onChildExit(code, signal));

    const url = `http://127.0.0.1:${port}`;
    this.url = url;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    if (onStage) onStage("health-check");
    while (Date.now() < deadline) {
      if (this.earlyExit && !this.usingLauncher) {
        throw new Error(
          `Backend exited early (code=${this.earlyExit.code}). See ${logPath}`,
        );
      }
      if (this.stopped) throw new Error("Backend startup aborted");
      if (await this.isHealthy(url)) {
        if (this.usingLauncher) {
          // The launcher may already have handed off; adopt the real pid.
          this.adoptedPid = this.adoptedPid || this.readAdoptedPid();
        }
        if (onStage) onStage("ready");
        return url;
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
    }
    throw new Error(`Backend health check timed out. See ${logPath}`);
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
            this.adoptedPid = this.readAdoptedPid();
            // Handoff complete: the real backend keeps running; no crash.
            return;
          }
          // Not healthy yet: the backend may still be booting under the
          // launcher's work. start()'s health deadline owns the verdict.
        })
        .catch(() => {});
    });
  }

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

  async stop() {
    this.stopped = true;
    const child = this.child;
    this.child = null;
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        await this.killTree(child.pid, child);
      } else if (this.adoptedPid) {
        // The launcher already exited; the real backend runs on its own pid.
        await this.killTree(this.adoptedPid, null);
      }
    } finally {
      this.closeLog();
    }
  }

  killTree(pid, child) {
    return new Promise((resolve) => {
      const onDone = () => resolve();
      if (process.platform === "win32") {
        // uvicorn may hold child handles; kill the whole tree.
        this.spawnFn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          windowsHide: true,
        }).on("exit", onDone);
        setTimeout(onDone, 8000).unref();
        return;
      }
      if (child) {
        child.on("exit", onDone);
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, 5000).unref();
      } else {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Already gone.
        }
        setTimeout(onDone, 1000).unref();
      }
      setTimeout(onDone, 8000).unref();
    });
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
  rotateLogFile,
  runtimeMarkerPath,
  runtimeMarkerDigest,
  isRuntimeMarkerValid,
};
