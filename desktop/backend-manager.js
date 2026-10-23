// SPDX-License-Identifier: Apache-2.0
"use strict";

// BackendManager - spawn the backend (uvicorn) and wait until it is healthy.
//
// This mirrors what scripts/Start-ResumeForge.ps1 does for the console flow,
// reduced to what the desktop shell needs: pick a free loopback port, launch
// the venv python with uvicorn, poll /api/health, and shut the process tree
// down cleanly on exit. Console output goes to <runtimeDir>/logs/
// desktop-backend.log (user directory) so no console window is ever involved.
//
// 故障诊断 P0：安装目录/payload 一律只读。日志与其降级链、pid 记录的位置都
// 收在 lib/shell-paths.js 里裁决；本文件只保证"写不进去也绝不打断启动"。
//
// ADR-0004 (data directory policy): when the shell hands us a user data dir,
// the backend runs with RF_DATA_DIR pointing at it, so the database,
// attachments, exports and backups land under the user profile instead of the
// (possibly read-only) install payload.

const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const processIdentity = require("./lib/process-identity");
const { attachBackendChild } = require("./lib/backend-startup");
const { BACKEND_COMMAND_PATTERNS: BACKEND_COMMAND_PATTERNS_FOR_RECORDS, stopBackend } = require("./lib/backend-stop");
const { buildBackendEnv, buildChildEnv, resolveDesktopLogDir } = require("./lib/backend-env");
const { logHint: formatLogHint } = require("./lib/shell-paths");
const {
  PID_RECORD_MACOS_NAME, PID_RECORD_NAME, adoptRecordedBackend: adoptRecorded,
  backendLogFile, captureSpawnedChild, closeLogStream, logDegradedNotice,
  openBackendLog, pidRecordDir, readPidRecord,
} = require("./lib/backend-logs");
const {
  RUNTIME_ZIP_NAME,
  diagnoseRuntimeFailure,
  extractZip,
  isRuntimeMarkerValid,
  readBundledManifest,
  resolvePython,
  resolveRuntimePython,
  rotateLogFile,
  runtimeMarkerDigest,
  runtimeMarkerPath,
  runtimeMatchesManifest,
} = require("./lib/backend-runtime");

const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 300;
// 兜底启动器（Start-ResumeForge.ps1 / start.sh）退出前会记下真后端进程；记录的
// 位置与形状由 lib/backend-logs.js 裁决（RR-02）。打包态只能写用户目录，payload
// 下的 runtime/ 只是只读的历史位置：仍然读、绝不再写。

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
    // 实际写出的日志路径（可能已降级到临时目录）；null = 本次运行不写日志。
    // 绝不能是 payload 下的路径：那里只读，写它只会失败（诊断 P0）。
    this.logPath = null;
    this.logDegraded = false;
    this.logReason = "";
    // 面向用户的那一句"日志在哪"，openLog() 会整体替换（lib/backend-logs.js）。
    this.logHintText = formatLogHint(null, false);
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
    // Bounded tail of the child's stderr (lib/backend-startup.js fills it in).
    // Used to turn an opaque "exited early (code=1)" into the real cause.
    this.stderrTail = "";
    // Outcome of the last stop(): { ok, reason, verified }. The shell reads it
    // before letting an update installer overwrite this installation.
    this.lastStop = null;
    // Set by the shell: called when the backend dies while we did not ask
    // it to (crash supervision hook).
    this.onUnexpectedExit = null;
  }

  // 日志的**首选**路径（永远在用户目录的 runtimeDir 下）。真正打开日志时若
  // 这里不可写，openLog() 会降级到临时目录，并以 this.logPath 为准。
  logFile() {
    return backendLogFile(this.runtimeDir);
  }

  // 运行期记录（pid 记录、日志）的写入根，见 lib/backend-logs.js::pidRecordDir；
  // 更远的只读回退（payload 下的历史位置）由同文件的 pidRecordPaths 负责。
  pidDir() {
    return pidRecordDir(this);
  }

  adoptedPidFile() {
    return path.join(this.pidDir(), PID_RECORD_NAME);
  }

  adoptedPidMacosFile() {
    return path.join(this.pidDir(), PID_RECORD_MACOS_NAME);
  }

  // 打开日志流：runtimeDir -> 系统临时目录 -> 不写日志，逐级降级（lib/backend-logs.js），
  // 任何一步失败都只标记降级，绝不抛。start() 的日志初始化因此是安全的。
  openLog(banner) {
    this.closeLog();
    const opened = openBackendLog({ runtimeDir: this.runtimeDir, banner });
    this.logStream = opened.stream;
    this.logPath = opened.path;
    this.logDegraded = opened.degraded;
    this.logReason = opened.reason;
    this.logHintText = opened.hint;
    return this.logPath;
  }

  // 桌面壳日志的真实落点（→ RF_DESKTOP_LOG_DIR）。裁决在
  // lib/backend-env.js::resolveDesktopLogDir：openLog() 打开的日志在哪个目录就看
  // 那个目录，没打开才回退 lib/shell-paths.js（绝不在这里另拼路径）。
  desktopLogDir() {
    return resolveDesktopLogDir({ logPath: this.logPath, runtimeDir: this.runtimeDir });
  }

  // 错误信息里给用户看的那一句：有路径给路径，降级说降级，没有就直说不可用。
  logHint() {
    return this.logHintText;
  }

  // 供壳（main.js）展示的降级说明；未降级返回空串。
  degradedLogNotice() {
    return logDegradedNotice({
      path: this.logPath,
      degraded: this.logDegraded,
      reason: this.logReason,
    });
  }

  // 记录形状、读取顺序与"哪种形状先读"的裁决都在 lib/backend-logs.js；
  // 这里是壳对外的既有接口（用例与 start() 都按名字调用）。
  readAdoptedRecord() {
    return readPidRecord(this);
  }

  readAdoptedPid() {
    const record = this.readAdoptedRecord();
    return record ? record.pid : null;
  }

  // 身份快照 + 共享记录文件的写入同样下沉（记录格式只有一个出处）；这里只把
  // 管理器自己的注入依赖递过去。
  recordSpawnedChild(pid) {
    return captureSpawnedChild(this, pid);
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
    // Fingerprint of what this build shipped (payload/repo root). Absent on mac
    // payloads (which carry no zip by design, see build-desktop-mac.sh) and on
    // builds predating the manifest -> null, and then nothing is compared.
    const manifest = readBundledManifest(this.projectRoot);
    if (!fs.existsSync(zipPath)) {
      return;
    }
    const python = resolveRuntimePython(this.runtimeDir);
    // Three conditions, in cost order: the interpreter exists, the tree came
    // from THIS zip, and the tree matches the dependency fingerprint. The
    // third is what the zip digest cannot express -- a payload whose zip was
    // replaced by a stale cache produces a perfectly matching digest.
    if (
      fs.existsSync(python) &&
      (await isRuntimeMarkerValid(this.runtimeDir, zipPath)) &&
      runtimeMatchesManifest(this.runtimeDir, manifest)
    ) {
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
        // Stamp the fingerprint this tree was built with, so the next launch can
        // compare against a newer manifest without reopening the zip. Absent
        // fields are simply omitted (JSON.stringify drops undefined).
        python: manifest ? manifest.pythonVersion : undefined,
        requirementsSha256: manifest ? manifest.requirementsSha256 : undefined,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  // 三条启动路径（打包运行时 / 兜底启动器 / 开发树 venv）共用同一份 spawn 选项：
  // 无窗口、管道 IO、注入的 env，任何情况下都不弹控制台。
  spawnChild(file, args, env, cwd = path.join(this.projectRoot, "backend")) {
    return this.spawnFn(file, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
  }

  // 两条直连路径跑的是同一条 uvicorn 命令，只有解释器不同。收在一处，参数顺序
  // （健康探测与既有用例都依赖它）就只有这一个出处。
  spawnUvicorn(pythonPath, port, env) {
    const args = [
      "-m",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--log-level",
      "warning",
    ];
    return this.spawnChild(pythonPath, args, env);
  }

  async start(onStage) {
    // A fresh launch supersedes an earlier stop (crash-restart path).
    this.stopped = false;
    this.lastStop = null;
    await this.prepareRuntime(onStage);
    const port = await findFreePort();
    // 日志初始化绝不能让 start() 抛错：安装目录只读是正常形态，不是启动失败。
    this.openLog(`desktop launch ${new Date().toISOString()} port=${port}`);

    if (onStage) onStage("backend-starting");

    // 子进程 env 的组装（RF_DATA_DIR / RF_DESKTOP_LOG_DIR / RF_DESKTOP_SHELL /
    // mac 打包态的 RF_STATE_DIR）全部在 lib/backend-env.js::buildChildEnv，
    // 连同"为什么要有这几个变量"的理由一起收在那里。
    const childEnv = buildChildEnv({
      userDataDir: this.userDataDir,
      desktopLogDir: this.desktopLogDir(),
      packaged: this.packaged,
      runtimeDir: this.runtimeDir,
    });

    const bundled = resolveRuntimePython(this.runtimeDir);
    this.usingLauncher = false;
    if (fs.existsSync(bundled)) {
      // Preferred: the bundled runtime is a complete env (interpreter +
      // site-packages), so uvicorn starts directly with no provisioning.
      this.child = this.spawnUvicorn(bundled, port, childEnv);
    } else if (this.packaged) {
      // Fallback: defer to the shipped launcher (python/node bootstrap, venv,
      // dependency install). Hidden window, pinned port. Slow on first run -
      // the bundled runtime exists precisely to avoid this path.
      this.usingLauncher = true;
      const launcher = this.launcherCommand(port);
      this.child = this.spawnChild(launcher.file, launcher.args, childEnv, launcher.cwd);
    } else {
      this.child = this.spawnUvicorn(resolvePython(this.projectRoot), port, childEnv);
    }
    attachBackendChild(this);

    const url = `http://127.0.0.1:${port}`;
    this.url = url;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    if (onStage) onStage("health-check");
    while (Date.now() < deadline) {
      if (this.startupError) {
        this.closeLog();
        throw new Error(
          `Backend spawn failed: ${this.startupError.message}. See ${this.logHint()}`,
        );
      }
      if (this.earlyExit && !this.usingLauncher) {
        // A missing dependency is the one early exit a user can act on, and the
        // raw "exited early (code=1)" tells them nothing. The log hint stays:
        // the full traceback is there for whoever debugs it.
        const diagnosis = diagnoseRuntimeFailure(this.stderrTail);
        if (diagnosis) {
          throw new Error(`${diagnosis}日志：${this.logHint()}`);
        }
        throw new Error(
          `Backend exited early (code=${this.earlyExit.code}). See ${this.logHint()}`,
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
    throw new Error(`Backend health check timed out. See ${this.logHint()}`);
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

  // Adopt/refresh the record the launcher wrote (record format lives in
  // lib/backend-logs.js); re-read on every health success so a crash-restart
  // replaces the stale pid instead of carrying it forward (RR-02).
  adoptRecordedBackend() {
    adoptRecorded(this);
  }

  closeLog() {
    const stream = this.logStream;
    this.logStream = null;
    closeLogStream(stream);
  }
}

module.exports = {
  BackendManager,
  // 后端 env 构造已下沉到 lib/backend-env.js；re-export 保持既有 import 路径
  // （用例与 main.js 都从本模块取 buildBackendEnv）。
  buildBackendEnv,
  // Runtime helpers live in lib/backend-runtime.js; re-exported here so the
  // existing callers/tests keep their import path.
  rotateLogFile, runtimeMarkerPath, runtimeMarkerDigest, isRuntimeMarkerValid,
};
