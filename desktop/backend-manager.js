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

class BackendManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.child = null;
    this.logStream = null;
    this.stopped = false;
  }

  logFile() {
    return path.join(this.projectRoot, "runtime", "logs", "desktop-backend.log");
  }

  async start(onStage) {
    const python = resolvePython(this.projectRoot);
    const port = await findFreePort();
    const logPath = this.logFile();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    this.logStream = fs.createWriteStream(logPath, { flags: "a" });
    this.logStream.write(`\n==== desktop launch ${new Date().toISOString()} port=${port} ====\n`);

    if (onStage) onStage("backend-starting");

    this.child = spawn(
      python,
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
    this.child.stdout.on("data", (chunk) => this.logStream.write(chunk));
    this.child.stderr.on("data", (chunk) => this.logStream.write(chunk));

    let earlyExit = null;
    this.child.on("exit", (code, signal) => {
      earlyExit = { code, signal };
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
