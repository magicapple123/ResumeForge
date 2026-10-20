// SPDX-License-Identifier: Apache-2.0
"use strict";

// Bundled-runtime provisioning and log rotation for the desktop shell.
//
// Split out of backend-manager.js (line budget): everything here is pure file
// work -- where the zipped Python runtime lives, whether the unpacked tree is
// still the one the zip describes, and how the backend log stays bounded. The
// manager keeps the process lifecycle.
//
// ADR-0004 (data directory policy): the runtime tree is shared by installer
// and portable forms under the user profile, never inside the install payload.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Release archives may carry a zipped Python runtime (phase 3 packaging).
// When present it is unpacked once into the shared data dir and preferred
// over the dev-tree venv; dev trees simply keep using the venv.
const RUNTIME_ZIP_NAME = "python-runtime.zip";
// The backend log is appended on every launch and every restart; without a
// cap a long-lived install accumulates gigabytes. One previous generation is
// kept for post-mortems.
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function resolveRuntimePython(runtimeDir) {
  return process.platform === "win32"
    ? path.join(runtimeDir, "python", "python.exe")
    : path.join(runtimeDir, "python", "bin", "python3");
}

// Dev-tree fallback: the repository's own virtualenv interpreter.
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

// Which tar reads zip archives.
//
// bsdtar (Windows 10+, macOS) reads them; GNU tar -- which is what a PATH that
// leads with Git for Windows (C:\Program Files\Git\usr\bin) resolves to --
// does not, and fails with a bare "tar exited with 1". A packaged app is
// normally started from Explorer (System32 first in PATH), but nothing
// guarantees that: double-clicking the exe from a Git shell, or a launcher
// that inherited that PATH, would hand the unpack a GNU tar and the shell
// would never come up. So on Windows the system bsdtar is named explicitly
// (it ships with the OS since 10 1803) and PATH is only the fallback.
function tarExecutable(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.windir;
    if (systemRoot) {
      const systemTar = path.join(systemRoot, "System32", "tar.exe");
      if (fs.existsSync(systemTar)) return systemTar;
    }
  }
  return "tar";
}

function extractZip(zipPath, targetDir, spawnFn = spawn) {
  // spawnFn is injectable so tests can pin the call without depending on the
  // platform tar (and so a missing `spawn` import fails loudly at the default
  // parameter).
  return new Promise((resolve, reject) => {
    const child = spawnFn(tarExecutable(), ["-xf", zipPath, "-C", targetDir], {
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

module.exports = {
  LOG_MAX_BYTES,
  RUNTIME_ZIP_NAME,
  extractZip,
  isRuntimeMarkerValid,
  resolvePython,
  resolveRuntimePython,
  rotateLogFile,
  runtimeMarkerDigest,
  runtimeMarkerPath,
  tarExecutable,
};
