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

// --- runtime manifest (report task 10) -----------------------------------------
//
// The zipped runtime carries python-runtime.manifest.json (schema, pythonVersion,
// requirementsSha256 -- stamped by scripts/PythonRuntimeManifest.ps1). Both build
// scripts also copy that entry to the payload root as runtime-manifest.json, so
// an INSTALLED shell can compare "what this build shipped" against "what this
// machine unpacked" without opening the zip again.
//
// Why the extra check on top of the zip digest: the digest only proves the
// runtime tree came from *this* zip. It cannot tell a half-installed tree or a
// payload whose zip was replaced by a stale cache from a good one. The manifest
// carries the build's own fingerprint, which is the thing that actually changed
// in the 1.0.1 incident (requirements gained pypdfium2, cached zip did not).

const RUNTIME_MANIFEST_NAME = "runtime-manifest.json";

function runtimeManifestPath(projectRoot) {
  return path.join(projectRoot, RUNTIME_MANIFEST_NAME);
}

// Returns the parsed manifest, or null when it is missing/unreadable/corrupt.
// Every failure mode collapses to "no fingerprint available": a corrupt sidecar
// must never block a launch (the runtime digest check still applies).
//
// The BOM strip matters: PowerShell 5.1's `-Encoding UTF8` writes one, and
// JSON.parse throws on it, which would silently disable the check on builds
// written by an older toolchain.
function readParsedJson(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(text);
    // Arrays and scalars are valid JSON but not a manifest/marker: an array
    // would pass a bare typeof check and then make every field read undefined.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readBundledManifest(projectRoot) {
  return readParsedJson(runtimeManifestPath(projectRoot));
}

// The marker is written by prepareRuntime; reading it back is shared by the
// manifest comparison and (indirectly) by the stop/start bookkeeping.
function readRuntimeMarker(runtimeDir) {
  return readParsedJson(runtimeMarkerPath(runtimeDir));
}

// runtimeMatchesManifest(runtimeDir, manifest) -> boolean
//
// True when the unpacked tree agrees with the bundled fingerprint. A marker that
// predates the fingerprint fields is treated as "unknown" and passes: upgrading a
// 0.9.x install must not re-unpack a runtime that is in fact complete (unpacking
// takes minutes and, on a metered/offline machine, can fail outright).
function runtimeMatchesManifest(runtimeDir, manifest) {
  if (!manifest || typeof manifest !== "object") return true;
  const marker = readRuntimeMarker(runtimeDir);
  if (!marker) return false;
  const recordedPython = typeof marker.python === "string" ? marker.python : null;
  const recordedRequirements =
    typeof marker.requirementsSha256 === "string" ? marker.requirementsSha256 : null;
  if (recordedPython === null && recordedRequirements === null) return true;
  if (
    recordedPython !== null &&
    typeof manifest.pythonVersion === "string" &&
    recordedPython !== manifest.pythonVersion
  ) {
    return false;
  }
  if (
    recordedRequirements !== null &&
    typeof manifest.requirementsSha256 === "string" &&
    recordedRequirements !== manifest.requirementsSha256
  ) {
    return false;
  }
  return true;
}

// --- dependency-failure diagnosis ----------------------------------------------

// The one failure shape worth translating: a runtime that unpacked but is
// missing a package the backend imports at startup. Users cannot act on the
// Python traceback, and the wrong "fix" (dropping a .whl into site-packages)
// breaks the next update.
const MISSING_DEPENDENCY_PATTERN = /ModuleNotFoundError|ImportError/;
const MISSING_MODULE_PATTERNS = [
  /ModuleNotFoundError:\s*No module named\s*['"]([^'"]+)['"]/g,
  /ImportError:\s*No module named\s*['"]([^'"]+)['"]/g,
  /No module named\s*['"]([^'"]+)['"]/g,
];

function extractMissingModule(stderrTail) {
  for (const pattern of MISSING_MODULE_PATTERNS) {
    // Fresh regex per call: the patterns carry /g and lastIndex would otherwise
    // leak between calls (a classic footgun that makes the second launch report
    // nothing).
    const matcher = new RegExp(pattern.source, "g");
    let match = matcher.exec(stderrTail);
    let lastName = null;
    while (match !== null) {
      lastName = match[1];
      match = matcher.exec(stderrTail);
    }
    // Last occurrence wins: the tail holds the most recent failure.
    if (lastName) return lastName;
  }
  return null;
}

// diagnoseRuntimeFailure(stderrTail) -> Chinese explanation, or null.
function diagnoseRuntimeFailure(stderrTail) {
  if (typeof stderrTail !== "string" || stderrTail.length === 0) return null;
  if (!MISSING_DEPENDENCY_PATTERN.test(stderrTail)) return null;
  const moduleName = extractMissingModule(stderrTail) || "未知模块";
  return (
    `运行时缺少依赖（安装可能损坏）：${moduleName}。` +
    "请重新安装本软件，不要手动改安装目录。"
  );
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
  RUNTIME_MANIFEST_NAME,
  RUNTIME_ZIP_NAME,
  diagnoseRuntimeFailure,
  extractZip,
  isRuntimeMarkerValid,
  readBundledManifest,
  readRuntimeMarker,
  resolvePython,
  resolveRuntimePython,
  rotateLogFile,
  runtimeManifestPath,
  runtimeMarkerDigest,
  runtimeMarkerPath,
  runtimeMatchesManifest,
  tarExecutable,
};
