"use strict";

// Lightweight self-updater for the packaged desktop shell (phase 4).
//
// Design (per the confirmed plan):
//   - The shell + payload are one versioned unit; releases carry
//     ResumeForge-Setup-<version>.exe and a .sha256 sidecar.
//   - update check = GitHub releases/latest, hop-by-hop domain allowlist
//     (same discipline as the backend's update_allowed_hosts: we follow
//     redirects manually and validate every host, we never fetch blindly).
//   - verify sha256 before offering the install; no checksum, no update.
//   - install = quit the app (stopping the backend via before-quit) then run
//     the NSIS installer silently, so no file handles are held.

const { app, dialog } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const RELEASES_API = "https://api.github.com/repos/magicapple123/ResumeForge/releases/latest";
// Every host we are willing to touch, including redirect hops.
const ALLOWED_HOSTS = new Set([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const CHECK_DELAY_MS = 30_000;

function versionCompare(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchAllowed(url, init) {
  // Manual redirect following: every hop's host must be allowlisted.
  let current = url;
  for (let hop = 0; hop < 10; hop += 1) {
    const parsed = new URL(current);
    if (!ALLOWED_HOSTS.has(parsed.host)) {
      throw new Error(`update host not allowed: ${parsed.host}`);
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
  const response = await fetchAllowed(RELEASES_API, { timeout: 15_000 });
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

async function downloadTo(url, destPath) {
  const response = await fetchAllowed(url, { timeout: DOWNLOAD_TIMEOUT_MS });
  if (!response.ok) throw new Error(`download returned ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

function findAsset(release, predicate) {
  return (release.assets || []).find(predicate);
}

async function checkAndOfferUpdate(parentWindow) {
  if (!app.isPackaged) return;
  const release = await fetchLatestRelease();
  const latest = release.tag_name || "";
  if (versionCompare(latest, app.getVersion()) <= 0) return;

  const assetName = `ResumeForge-Setup-${latest.replace(/^v/, "")}.exe`;
  const installer = findAsset(release, (a) => a.name === assetName);
  const checksum = findAsset(release, (a) => a.name === `${assetName}.sha256`);
  if (!installer || !checksum) {
    // Release exists but assets incomplete: skip rather than half-update.
    return;
  }

  const choice = await dialog.showMessageBox(parentWindow, {
    type: "info",
    message: `发现新版本 ${latest.replace(/^v/, "")}`,
    detail: "将下载并安装更新，期间应用会自动重启。",
    buttons: ["立即更新", "暂不"],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice.response !== 0) return;

  const tempDir = path.join(app.getPath("temp"), "resumeforge-update");
  fs.mkdirSync(tempDir, { recursive: true });
  const installerPath = path.join(tempDir, assetName);
  const checksumPath = path.join(tempDir, `${assetName}.sha256`);

  await downloadTo(installer.browser_download_url, installerPath);
  await downloadTo(checksum.browser_download_url, checksumPath);

  // Checksum sidecar format: "<hex>  <filename>" (sha256sum style).
  const expected = fs
    .readFileSync(checksumPath, "utf-8")
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  const actual = await sha256File(installerPath);
  if (actual !== expected) {
    throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`);
  }

  const install = await dialog.showMessageBox(parentWindow, {
    type: "info",
    message: "更新包校验通过",
    detail: "应用将退出并自动运行安装程序。",
    buttons: ["立即安装", "取消"],
    defaultId: 0,
    cancelId: 1,
  });
  if (install.response !== 0) return;

  // Detached installer survives our exit; we quit first so the backend tree
  // goes down through the normal before-quit path and no files are locked.
  const child = require("child_process").spawn(installerPath, ["/S"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  app.quit();
}

function scheduleUpdateCheck(parentWindow, logLine) {
  if (!app.isPackaged) return;
  setTimeout(() => {
    checkAndOfferUpdate(parentWindow)
      .catch((err) => {
        if (logLine) logLine(`update check failed: ${err}`);
      });
  }, CHECK_DELAY_MS);
}

module.exports = { scheduleUpdateCheck, versionCompare };
