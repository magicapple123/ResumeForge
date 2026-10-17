"use strict";

// Lightweight self-updater for the packaged desktop shell (phase 4).
//
// Design (per the confirmed plan, hardened in the 2026-10-13 audit PR-05):
//   - The shell + payload are one versioned unit; releases carry
//     ResumeForge-Setup-<version>.exe and a .sha256 sidecar.
//   - update check = GitHub releases/latest, hop-by-hop domain allowlist
//     (same discipline as the backend's update_allowed_hosts: we follow
//     redirects manually and validate every host, we never fetch blindly).
//   - Every fetch carries a real AbortSignal (a `timeout` option alone is not
//     a cancel signal: it cannot abort an in-flight response).
//   - Downloads are bounded and streamed: Content-Length pre-check, chunked
//     append to a .part staging file, hard size cap, and the payload only
//     replaces the candidate installer after the sha256 sidecar verifies.
//   - install = hand the verified installer to main.js's installAndQuit(),
//     which quits the app; main's before-quit stops the backend and schedules
//     the installer only after the stop completes. The installer itself runs
//     from a detached wait-for-pid PowerShell helper (installerWaitCommand)
//     so the NSIS /S run never races the live shell's file handles.
//   - One confirmation up front ("将下载并安装更新，期间应用会自动重启") authorizes
//     the whole download->verify->install->restart flow; a second blocking
//     dialog after the checksum used to strand the install when the user was
//     away or the window sat in the tray.

const { app, dialog } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");

const RELEASES_API = "https://api.github.com/repos/magicapple123/ResumeForge/releases/latest";
// Every host we are willing to touch, including redirect hops.
const ALLOWED_HOSTS = new Set([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const METADATA_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
// The NSIS installer is tens of MB; anything approaching this cap is a
// misrouted or hostile response, not an update.
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const CHECK_DELAY_MS = 30_000;
// 启动后的一次检查可能赶上机器离线（Wi-Fi 未连、VPN 未拨）：之后每 6 小时补查
// 一次，失败静默记日志。unref 保证定时器不会阻止应用退出。
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASE_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

// Electron 33 embeds Node 20, where AbortSignal.timeout exists (the backend
// health probe already relies on it). The manual controller is a fallback for
// exotic runtimes only.
function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref();
  return controller.signal;
}

function versionCompare(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizedReleaseVersion(value) {
  if (typeof value !== "string") return null;
  const match = RELEASE_VERSION_RE.exec(value.trim());
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function isReleaseAssetUrl(value, expectedName, tag) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash
    ) {
      return false;
    }
    // Metadata comes from our releases API; its original asset URLs must still
    // belong to this repository and this release. Redirects are checked separately.
    return decodeURIComponent(parsed.pathname) ===
      `/magicapple123/ResumeForge/releases/download/${tag}/${expectedName}`;
  } catch {
    return false;
  }
}

async function fetchAllowed(url, init) {
  // Manual redirect following: every hop's host must be allowlisted.
  let current = url;
  for (let hop = 0; hop < 10; hop += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) {
      throw new Error(`update host not allowed: ${parsed.hostname}`);
    }
    const response = await fetch(current, {
      ...init,
      redirect: "manual",
      headers: {
        "User-Agent": "ResumeForge-Desktop-Updater",
        Accept: "application/vnd.github+json",
        ...(init && init.headers ? init.headers : {}),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("redirect without location");
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new Error("too many redirects");
}

async function fetchLatestRelease() {
  const response = await fetchAllowed(RELEASES_API, {
    signal: timeoutSignal(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`releases/latest returned ${response.status}`);
  return response.json();
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// Bounded streaming download: the payload lands in `<dest>.part` and the
// caller is responsible for verifying the checksum before renaming it over
// `dest`. Any failure (HTTP error, size cap, stream error) removes the
// staging file and leaves `dest` untouched.
async function downloadToFile(url, destPath, { maxBytes = MAX_DOWNLOAD_BYTES } = {}) {
  const response = await fetchAllowed(url, { signal: timeoutSignal(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`download returned ${response.status}`);

  // Size gates first: an oversized declared body is rejected before the
  // stream is even touched.
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw new Error(
      `download too large: content-length ${declared} exceeds the ${maxBytes} byte cap`,
    );
  }
  if (!response.body) throw new Error("download response has no body");

  const partPath = `${destPath}.part`;
  // Real fetches expose a web ReadableStream; test doubles may pass any async
  // iterable. Both are consumed chunk by chunk -- never buffered whole.
  const bodyStream =
    typeof response.body.getReader === "function"
      ? Readable.fromWeb(response.body)
      : response.body;

  let total = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new Error(`download exceeded size limit: ${total} bytes streamed, cap is ${maxBytes}`));
      } else {
        callback(null, chunk);
      }
    },
  });
  let created = false;
  const out = fs.createWriteStream(partPath, { flags: "wx" });
  out.once("open", () => { created = true; });
  try {
    // pipeline propagates ENOSPC/permission/open errors and aborts all streams;
    // waiting only for "drain" would hang forever after a filesystem error.
    await pipeline(bodyStream, limiter, out);
  } catch (err) {
    if (created) {
      try { fs.rmSync(partPath, { force: true }); } catch {}
    }
    throw err;
  }
  return { partPath, size: total };
}

function findAsset(release, predicate) {
  return (release.assets || []).find(predicate);
}

// 窗口可能正藏在托盘里：所有更新对话框弹出前先把窗口带回来并抢焦点，
// 否则对话框跟着一个看不见的窗口，用户"永远看不到更新提示"（实测缺陷②）。
// 窗口为 null / 已销毁时返回 null，调用方退化为无 parent 的弹窗——对话框
// 仍然会显示。
function revealWindow(parentWindow) {
  if (!parentWindow || typeof parentWindow.isDestroyed !== "function") return null;
  try {
    if (parentWindow.isDestroyed()) return null;
    if (typeof parentWindow.isMinimized === "function" && parentWindow.isMinimized()) {
      parentWindow.restore();
    }
    parentWindow.show();
    parentWindow.focus();
    return parentWindow;
  } catch {
    // 任何窗口操作失败都不该拦住对话框本身。
    return null;
  }
}

async function showUpdateDialog(parentWindow, options) {
  const target = revealWindow(parentWindow);
  return target ? dialog.showMessageBox(target, options) : dialog.showMessageBox(options);
}

/**
 * 「等待主进程退出，再静默运行安装器」的命令构造（纯函数，便于离线单测）。
 *
 * NSIS 静默安装（`/S`）会覆盖 shell 的程序文件——如果它在 Electron 进程还活着、
 * exe 句柄未释放时启动，安装会撞锁静默失败（实测缺陷③）。所以安装器不再由
 * main.js 在退出前直接 spawn，而是交给一个脱离的 PowerShell 等待进程：
 * 先等主进程 pid 退出，再启动安装器。`-ErrorAction SilentlyContinue` 兜住
 * "进程恰好已经退出"的竞态（Wait-Process 找不到 pid 不算错误）。
 */
function installerWaitCommand(installerPath, mainPid) {
  const escaped = String(installerPath).replace(/'/g, "''");
  const script =
    `Wait-Process -Id ${Number(mainPid)} -ErrorAction SilentlyContinue; ` +
    `Start-Process -FilePath '${escaped}' -ArgumentList '/S'`;
  return {
    file: "powershell",
    args: ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
  };
}

async function checkAndOfferUpdate(parentWindow, deps = {}) {
  if (!app.isPackaged) return;
  // This installer protocol is NSIS/Windows only. Other platforms retain their supported manual update path.
  if (process.platform !== "win32") return;
  const release = await fetchLatestRelease();
  const latest = normalizedReleaseVersion(release.tag_name);
  const current = normalizedReleaseVersion(app.getVersion());
  if (!latest || !current) throw new Error("release version is not an exact stable semver");
  if (versionCompare(latest, current) <= 0) return;

  const assetName = `ResumeForge-Setup-${latest}.exe`;
  const checksumName = `${assetName}.sha256`;
  const installer = findAsset(
    release,
    (a) => a.name === assetName && isReleaseAssetUrl(a.browser_download_url, assetName, release.tag_name),
  );
  const checksum = findAsset(
    release,
    (a) => a.name === checksumName && isReleaseAssetUrl(a.browser_download_url, checksumName, release.tag_name),
  );
  if (!installer || !checksum) {
    // Release exists but assets incomplete: skip rather than half-update.
    return;
  }

  const choice = await showUpdateDialog(parentWindow, {
    type: "info",
    message: `发现新版本 ${latest}`,
    detail: "将下载并安装更新，期间应用会自动重启。",
    buttons: ["立即更新", "暂不"],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice.response !== 0) return;

  const tempDir = fs.mkdtempSync(path.join(app.getPath("temp"), "resumeforge-update-"));
  const installerPath = path.join(tempDir, assetName);
  const checksumPath = path.join(tempDir, `${assetName}.sha256`);

  const { partPath } = await downloadToFile(installer.browser_download_url, installerPath);
  let checksumPartPath;
  try {
    checksumPartPath = (await downloadToFile(checksum.browser_download_url, checksumPath, { maxBytes: 4096 })).partPath;
    fs.renameSync(checksumPartPath, checksumPath);
  } catch (err) {
    try {
      fs.rmSync(partPath, { force: true });
    } catch {}
    throw err;
  }

  // Checksum sidecar format: "<hex>  <filename>" (sha256sum style).
  const checksumText = fs.readFileSync(checksumPath, "utf-8").trim();
  const checksumMatch = /^(?<hash>[0-9a-f]{64})(?:\s+(?<name>\S+))?$/i.exec(checksumText);
  if (!checksumMatch || (checksumMatch.groups.name && checksumMatch.groups.name !== assetName)) {
    try {
      fs.rmSync(partPath, { force: true });
      fs.rmSync(checksumPath, { force: true });
    } catch {}
    throw new Error("checksum mismatch or invalid sidecar format");
  }
  const expected = checksumMatch.groups.hash.toLowerCase();
  const actual = await sha256File(partPath);
  if (actual !== expected) {
    try {
      fs.rmSync(partPath, { force: true });
    } catch {}
    throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`);
  }

  // Checksum verified -- only now does the downloaded payload replace the
  // candidate installer.
  fs.renameSync(partPath, installerPath);

  // 用户在第一次确认（"将下载并安装更新，期间应用会自动重启"）时已经授权了
  // 整个"下载 → 校验 → 安装 → 重启"流程；校验通过后**直接安装**，不再弹第二个
  // 阻塞确认——用户离开电脑或窗口在托盘里看不见时，那个确认框会让安装永远
  // 不发生（实测缺陷①）。这里只留一条日志记录自动安装的决定。
  if (typeof deps.onAutoInstall === "function") {
    deps.onAutoInstall(installerPath);
  }
  if (typeof deps.installAndQuit === "function") {
    // main.js owns the install sequencing: quit -> before-quit stops the
    // backend -> installer spawns after the stop completes.
    deps.installAndQuit(installerPath);
  } else {
    // Fallback (direct entry/tests): request the quit and let main's
    // before-quit path do the stopping. The updater itself never spawns the
    // installer ahead of the backend shutdown.
    app.quit();
  }
}

function scheduleUpdateCheck(parentWindow, logLine, deps = {}) {
  if (!app.isPackaged) return;
  if (process.platform !== "win32") return;
  // 校验通过即自动安装是这次的新行为：记一条日志，方便从 desktop-main.log
  // 回答"到底有没有尝试安装"。
  const wiredDeps = {
    ...deps,
    onAutoInstall:
      deps.onAutoInstall ||
      ((installerPath) => {
        if (logLine) logLine(`update verified, installing automatically: ${installerPath}`);
      }),
  };
  const runCheck = () => {
    checkAndOfferUpdate(parentWindow, wiredDeps).catch((err) => {
      if (logLine) logLine(`update check failed: ${err}`);
    });
  };
  setTimeout(runCheck, CHECK_DELAY_MS).unref();
  // 启动 30s 那一次如果机器离线就永远错过了；之后每 6 小时补查一次。
  // 若新版本已可用而用户此前点过「暂不」，补查会再次弹出确认——这是有意的
  // 取舍：本特性的目标就是"下载完成后安装真的发生"。unref 保证定时器不阻止退出。
  const interval = setInterval(runCheck, RECHECK_INTERVAL_MS);
  interval.unref();
}

module.exports = {
  scheduleUpdateCheck,
  checkAndOfferUpdate,
  versionCompare,
  timeoutSignal,
  downloadToFile,
  installerWaitCommand,
  MAX_DOWNLOAD_BYTES,
  isReleaseAssetUrl,
  normalizedReleaseVersion,
};
