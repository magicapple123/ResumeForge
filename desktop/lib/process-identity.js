"use strict";

// Process identity verification (RR-02).
//
// The shell reads a PID out of a record file written by the launchers
// (runtime/backend.json on Windows, runtime/backend.macos.pid on macOS) and may
// have to terminate the process tree it names. A PID on its own is not an
// identity: the OS recycles PIDs, records go stale (a previous console session,
// a crashed handoff), and killing a recycled PID means killing a stranger's
// process. Every adoption therefore re-checks the same three pieces of evidence
// the launchers themselves use before stopping anything:
//
//   1. the process still exists,
//   2. its command line matches the backend pattern
//      (Windows: `uvicorn\s+app\.main:app`, macOS: `uvicorn app.main:app`),
//   3. its start time equals the recorded one (Unix seconds on Windows, the
//      raw `ps -o lstart=` string on macOS -- see ResumeForge.Common.ps1 /
//      scripts/macos/lib/common.sh).
//
// Anything that cannot be positively confirmed is reported as unverifiable and
// the caller must NOT kill. Nothing in here kills, spawns or signals a process:
// it only reads. The exec function is injectable so the offline desktop tests
// can drive a fake process table instead of the real one.

const { execFile } = require("child_process");

const STATUS_VERIFIED = "verified";
// No such process: there is nothing to stop (a safe, expected outcome).
const STATUS_GONE = "gone";
// The process exists but is demonstrably NOT the recorded one (PID reuse).
const STATUS_MISMATCH = "mismatch";
// The evidence could not be read (no ps/CIM, permissions). Refuse to act.
const STATUS_UNVERIFIABLE = "unverifiable";

// Windows tolerance between the recorded start time and the observed one, in
// seconds. Same value as Get-ProcessRecordMatch in scripts/ResumeForge.Common.ps1.
const START_TIME_TOLERANCE_SECONDS = 2;

// Probe sentinel: the process table could not be read at all (probe failed /
// timed out / no ps|powershell). Distinct from `null`, which means the process
// is demonstrably absent.
const PROBE_UNREADABLE = Symbol("process-probe-unreadable");

const QUERY_TIMEOUT_MS = 10_000;

function defaultExecFile(file, args) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: QUERY_TIMEOUT_MS, maxBuffer: 1 << 20 },
      (error, stdout, stderr) => {
        resolve({
          code: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        });
      },
    );
  });
}

// --- record parsing -----------------------------------------------------------

// The Windows launcher writes JSON ({process_id, started_at_unix, started_at}),
// the macOS launcher a flat key=value file (process_id / started_at /
// start_signature). Both are read here so the shell speaks one shape.
function parseProcessRecord(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  let fields = null;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      fields = {
        process_id: parsed.process_id,
        started_at_unix: parsed.started_at_unix,
        start_signature: parsed.start_signature,
        started_at: parsed.started_at,
      };
    } catch {
      return null;
    }
  } else {
    fields = {};
    for (const line of raw.split(/\r?\n/)) {
      const index = line.indexOf("=");
      if (index <= 0) continue;
      fields[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
  }
  const pid = Number(fields.process_id);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const startedAtUnix = Number(fields.started_at_unix);
  const signature = typeof fields.start_signature === "string" ? fields.start_signature.trim() : "";
  return {
    pid,
    startedAtUnix: Number.isFinite(startedAtUnix) && startedAtUnix > 0 ? startedAtUnix : null,
    startSignature: signature || null,
    startedAt: typeof fields.started_at === "string" ? fields.started_at : "",
  };
}

// --- platform readers ---------------------------------------------------------

const WINDOWS_QUERY = [
  "$ErrorActionPreference = 'SilentlyContinue';",
  "$p = Get-Process -Id $PID_VALUE -ErrorAction SilentlyContinue;",
  "if ($null -eq $p) { Write-Output 'null'; exit 0 };",
  "try { $started = [DateTimeOffset]::new($p.StartTime).ToUnixTimeSeconds() } catch { $started = $null };",
  "$c = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $PID_VALUE) -ErrorAction SilentlyContinue;",
  "$command = $null; $exe = $null;",
  "if ($null -ne $c) { $command = $c.CommandLine; $exe = $c.ExecutablePath };",
  "[pscustomobject]@{ process_id = $p.Id; started_at_unix = $started; command_line = $command; executable_path = $exe } | ConvertTo-Json -Compress",
].join(" ");

async function readWindowsProcess(pid, execFileFn) {
  const script = WINDOWS_QUERY.replace(/\$PID_VALUE/g, String(pid));
  const result = await execFileFn("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  const output = result.stdout.trim();
  // "null" is the script's own answer for "no such process". Anything else --
  // spawn failure, timeout, empty output, a non-zero exit -- means the probe
  // could not run, which is NOT the same as "the process is gone": callers use
  // "gone" to conclude a stop succeeded (fail-closed means we must not).
  if (!output) return PROBE_UNREADABLE;
  if (output === "null") return null;
  // ConvertTo-Json may wrap single objects in an array depending on PowerShell
  // host quirks; accept both shapes.
  let payload = null;
  try {
    payload = JSON.parse(output);
  } catch {
    return PROBE_UNREADABLE;
  }
  if (Array.isArray(payload)) payload = payload[0];
  if (!payload || typeof payload !== "object") return PROBE_UNREADABLE;
  const startedAtUnix = Number(payload.started_at_unix);
  return {
    pid,
    startedAtUnix: Number.isFinite(startedAtUnix) && startedAtUnix > 0 ? startedAtUnix : null,
    startSignature: null,
    commandLine: typeof payload.command_line === "string" ? payload.command_line : null,
    executablePath: typeof payload.executable_path === "string" ? payload.executable_path : null,
  };
}

async function readPosixProcess(pid, execFileFn) {
  // Same two probes as scripts/macos/lib/common.sh: the raw lstart string is
  // the start-time signature, `args` the command line.
  const started = await execFileFn("ps", ["-p", String(pid), "-o", "lstart="]);
  // 与启动器**逐字一致**：scripts/macos/lib/common.sh 只去掉首尾空白，不折叠内部
  // 空格——macOS 的 %e 会把个位数日期补成两个空格（"Mon Nov  2 …"），折叠后就和
  // 记录对不上，每月 1–9 号都会把自己的后端判成"不是我们的"而拒绝停止。
  const signature = started.stdout.trim();
  if (!signature) {
    // `ps -p <pid>` exits 1 with empty output when the pid does not exist --
    // that is the "gone" answer. A probe that could not run at all (ps
    // missing, permission error) reports something on stderr or exits with
    // another code, and must NOT be mistaken for a completed stop.
    return started.code === 1 ? null : PROBE_UNREADABLE;
  }
  const command = await execFileFn("ps", ["-p", String(pid), "-o", "args="]);
  const commandLine = command.stdout.trim();
  return {
    pid,
    startedAtUnix: null,
    startSignature: signature,
    commandLine: commandLine || null,
    executablePath: null,
  };
}

// --- public API ---------------------------------------------------------------

async function readProcessInfo(
  pid,
  { execFileFn = defaultExecFile, platform = process.platform } = {},
) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  // platform is injectable so both readers can be exercised on any host (the
  // macOS branch is otherwise untestable without a Mac).
  if (platform === "win32") return readWindowsProcess(pid, execFileFn);
  return readPosixProcess(pid, execFileFn);
}

function commandMatches(commandLine, commandPatterns) {
  if (typeof commandLine !== "string" || !commandLine) return false;
  if (!commandPatterns || commandPatterns.length === 0) return false;
  return commandPatterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(commandLine);
    } catch {
      return false;
    }
  });
}

// Verify that `record` still describes a process we are allowed to stop.
// Returns { status, info, reason }: status is one of verified / gone /
// mismatch / unverifiable, and only "verified" authorises a kill.
async function verifyProcessRecord(record, { commandPatterns, execFileFn, platform } = {}) {
  if (!record || !Number.isInteger(record.pid) || record.pid <= 0) {
    return { status: STATUS_UNVERIFIABLE, info: null, reason: "记录里没有可用的进程号" };
  }
  const info = await readProcessInfo(record.pid, { execFileFn, platform });
  if (info === PROBE_UNREADABLE) {
    return { status: STATUS_UNVERIFIABLE, info: null, reason: "读不到进程表，无法确认目标是否还在" };
  }
  if (info === null) {
    return { status: STATUS_GONE, info: null, reason: "进程已不存在" };
  }
  if (!commandMatches(info.commandLine, commandPatterns)) {
    if (info.commandLine) {
      return { status: STATUS_MISMATCH, info, reason: "命令行与后端不符（PID 已被复用）" };
    }
    return { status: STATUS_UNVERIFIABLE, info, reason: "读不到命令行，无法确认身份" };
  }
  if (record.startedAtUnix && info.startedAtUnix) {
    const drift = Math.abs(info.startedAtUnix - record.startedAtUnix);
    if (drift > START_TIME_TOLERANCE_SECONDS) {
      return { status: STATUS_MISMATCH, info, reason: "启动时刻与记录不符（PID 已被复用）" };
    }
  } else if (record.startSignature && info.startSignature) {
    if (record.startSignature !== info.startSignature) {
      return { status: STATUS_MISMATCH, info, reason: "启动时刻签名与记录不符（PID 已被复用）" };
    }
  } else {
    return { status: STATUS_UNVERIFIABLE, info, reason: "缺少可核对的启动时刻，不能仅凭命令行停止进程" };
  }
  return { status: STATUS_VERIFIED, info, reason: "" };
}

// Has the process actually disappeared? Uses a cheap existence probe
// (process.kill(pid, 0)) instead of a full identity read: the identity was
// already verified before the kill, and spawning a PowerShell/ps probe every
// few hundred milliseconds would cost more than the kill itself. An
// unreadable probe (EPERM on a foreign process) counts as "still there" --
// fail-closed, the caller reports the stop as unconfirmed.
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

async function waitForProcessExit(
  pid,
  { timeoutMs = 5000, intervalMs = 300, existsFn = processExists } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!existsFn(pid)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

module.exports = {
  PROBE_UNREADABLE,
  processExists,
  START_TIME_TOLERANCE_SECONDS,
  STATUS_GONE,
  STATUS_MISMATCH,
  STATUS_UNVERIFIABLE,
  STATUS_VERIFIED,
  commandMatches,
  parseProcessRecord,
  readProcessInfo,
  verifyProcessRecord,
  waitForProcessExit,
};
