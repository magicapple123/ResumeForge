"use strict";

// BackendManager - spawn the backend (uvicorn) and wait until it is healthy.
//
// This mirrors what scripts/Start-ResumeForge.ps1 does for the console flow,
// reduced to what the desktop shell needs: pick a free loopback port, launch
// the venv python with uvicorn, poll /api/health, and shut the process tree
// down cleanly on exit. Console output goes to runtime/logs/desktop-backend.log
// so no console window is ever involved.

const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");

const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 300;
const PORT_SCAN_START = 8010;
const PORT_SCAN_END = 8099;
// Release archives may carry a zipped Python runtime (phase 3 packaging).
// When present it is unpacked once into the shared data dir and preferred
// over the dev-tree venv; dev trees simply keep using the venv.
const RUNTIME_ZIP_NAME = "python-runtime.zip";

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

class BackendManager {
  constructor(projectRoot, runtimeDir, { packaged = false } = {}) {
    this.projectRoot = projectRoot;
    this.runtimeDir = runtimeDir;
    this.packaged = packaged;
    this.child = null;
    this.logStream = null;
    this.stopped = false;
    // Set by the shell: called when the backend dies while we did not ask
    // it to (crash supervision hook).
    this.onUnexpectedExit = null;
  }

  logFile() {
    return path.join(this.projectRoot, "runtime", "logs", "desktop-backend.log");
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
    const completeMarker = path.join(this.runtimeDir, ".runtime-complete");
    if (fs.existsSync(python) && fs.existsSync(completeMarker)) return;

    if (onStage) onStage("preparing-runtime");
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    await extractZip(zipPath, this.runtimeDir);
    if (!fs.existsSync(python)) {
      throw new Error(
        `Runtime unpacked but interpreter missing: ${python} (zip layout mismatch?)`,
      );
    }
    fs.writeFileSync(completeMarker, new Date().toISOString());
  }

  async start(onStage) {
    await this.prepareRuntime(onStage);
    const port = await findFreePort();
    const logPath = this.logFile();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    this.logStream = fs.createWriteStream(logPath, { flags: "a" });
    this.logStream.write(`\n==== desktop launch ${new Date().toISOString()} port=${port} ====\n`);

    if (onStage) onStage("backend-starting");

    const bundled = resolveRuntimePython(this.runtimeDir);
    if (fs.existsSync(bundled)) {
      // Preferred: the bundled runtime is a complete env (interpreter +
      // site-packages), so uvicorn starts directly with no provisioning.
      this.child = spawn(
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
        },
      );
    } else if (this.packaged) {
      // Fallback: defer to the shipped launcher (python/node bootstrap, venv,
      // dependency install). Hidden window, pinned port. Slow on first run -
      // the bundled runtime exists precisely to avoid this path.
      const launcher = this.launcherCommand(port);
      this.child = spawn(launcher.file, launcher.args, {
        cwd: launcher.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      const venvPython = resolvePython(this.projectRoot);
      this.child = spawn(
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
        },
      );
    }
    this.child.stdout.on("data", (chunk) => this.logStream.write(chunk));
    this.child.stderr.on("data", (chunk) => this.logStream.write(chunk));

    let earlyExit = null;
    this.child.on("exit", (code, signal) => {
      earlyExit = { code, signal };
      if (!this.stopped && this.onUnexpectedExit) {
        this.onUnexpectedExit({ code, signal });
      }
    });

    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    if (onStage) onStage("health-check");
    while (Date.now() < deadline) {
      if (earlyExit) {
        throw new Error(
          `Backend exited early (code=${earlyExit.code}). See ${logPath}`,
        );
      }
      if (this.stopped) throw new Error("Backend startup aborted");
      if (await this.isHealthy(url)) {
        if (onStage) onStage("ready");
        return url;
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
    }
    throw new Error(`Backend health check timed out. See ${logPath}`);
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
    if (!child || child.exitCode !== null || child.signalCode) {
      this.closeLog();
      return;
    }
    await new Promise((resolve) => {
      const onExit = () => resolve();
      if (process.platform === "win32") {
        // uvicorn may hold child handles; kill the whole tree.
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        }).on("exit", onExit);
      } else {
        child.on("exit", onExit);
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, 5000).unref();
      }
      setTimeout(onExit, 8000).unref();
    });
    this.closeLog();
  }

  closeLog() {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}

module.exports = { BackendManager };
