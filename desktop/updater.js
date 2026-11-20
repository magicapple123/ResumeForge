// SPDX-License-Identifier: Apache-2.0
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
//   - One confirmation up front authorizes the whole download->verify->install->restart
//     flow; a second blocking dialog after the checksum used to strand the install when
//     the user was away or the window sat in the tray. Its body also states that the
//     update never touches user data (keys "update.*" in lib/shell-locale.js).
//
// 2026-11-20 第二轮（第 9 条）之后，本文件只剩"流程"，三件与流程无关的事各自下沉：
//   * 对话框 / 任务栏进度条 / 启动对账 -> lib/update-feedback.js（9.2 9.3 9.4）；
//   * 安装器命令构造 -> lib/installer-command.js（9.1，含 `--force-run` 的依据）；
//   * 更新尝试标记的读写 -> lib/update-attempt.js（9.2）。
// 理由：`desktop/**/*.js` 同样受 500 行预算（test_file_size_budget.py，零豁免）。

const { app, dialog, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
// 用户可见的对话框 / 进度条 / 启动对账（第 9.2 9.3 9.4 条）。
const { createUpdateFeedback } = require("./lib/update-feedback");
// 安装器命令（第 9.1 条）：本文件 re-export，main.js 与 quit-lifecycle 的入口不变。
const { installerWaitCommand } = require("./lib/installer-command");
// 更新尝试标记（第 9.2 条）：纯文件读写，不 require("electron")，可离线断言。
const { recordUpdateAttempt } = require("./lib/update-attempt");

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
//
// `onProgress(received, total)`（第 9.4 条）：188 MB 的安装包在慢网下要几分钟，
// 全程没有任何反馈时用户以为卡死了。回调按**百分比变化**节流（每 1% 一次），
// 不是每个 64KB 块一次——任务栏进度条不需要更细的粒度。`total` 为 0（服务端没给
// Content-Length）时不回调：那时算不出比例，宁可不动，也不要拿"0%"骗人。
async function downloadToFile(url, destPath, { maxBytes = MAX_DOWNLOAD_BYTES, onProgress } = {}) {
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

  const report = typeof onProgress === "function" ? onProgress : null;
  let received = 0;
  let lastPercent = -1;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) {
        callback(new Error(`download exceeded size limit: ${received} bytes streamed, cap is ${maxBytes}`));
        return;
      }
      if (report && declared > 0) {
        const percent = Math.min(Math.floor((received / declared) * 100), 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          try {
            report(received, declared);
          } catch {
            // 进度上报失败（窗口已销毁等）绝不能打断下载本身。
          }
        }
      }
      callback(null, chunk);
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
  return { partPath, size: received };
}

function findAsset(release, predicate) {
  return (release.assets || []).find(predicate);
}

// 对话框、进度条、启动对账、locale 裁决都在 lib/update-feedback.js
// （`createUpdateFeedback`）：本文件只留"什么时候该弹 / 该报进度"。

/** 标记文件必须落在用户目录（安装目录是只读契约）。 */
function userDataRoot() {
  try {
    return app.getPath("userData");
  } catch {
    return null;
  }
}

async function checkAndOfferUpdate(parentWindow, deps = {}) {
  if (!app.isPackaged) return;
  // This installer protocol is NSIS/Windows only. Other platforms retain their supported manual update path.
  if (process.platform !== "win32") return;
  // 用户可见的一切（对话框文案 / 语言 / 进度条）都从这里出（第 9.3 9.4 条）。
  const feedback = createUpdateFeedback({ app, dialog, shell }, deps);
  const release = await fetchLatestRelease();
  const latest = normalizedReleaseVersion(release.tag_name);
  const current = normalizedReleaseVersion(app.getVersion());
  if (!latest || !current) throw new Error("release version is not an exact stable semver");
  if (versionCompare(latest, current) <= 0) {
    // 手动检查（安装目录里的双击更新入口）需要一句"已是最新"；后台定时检查则保持安静，
    // 否则每 6 小时都会弹一次"没有新版本"。
    if (deps.onUpToDate) await deps.onUpToDate(current, latest);
    return;
  }

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
    //
    // 这里原先是直接 `return`：后台检查静默跳过可以理解，但**手动**检查（菜单「帮助 →
    // 检查更新」/ 安装目录的 update.cmd / 设置页的「检查更新」）也一声不响，用户看到的是
    // "点了没反应"，与"网络坏了"、"已经是最新"完全分不开。所以：
    //   - 一律留一条 warning 日志（写清缺的是哪个文件），
    //   - 手动检查时弹一句话说明这次没装成的原因。
    const missing = !installer ? assetName : checksumName;
    if (typeof deps.logLine === "function") {
      deps.logLine(`update assets incomplete for ${latest}: missing ${missing}`);
    }
    if (deps.manual) {
      await feedback.incomplete(parentWindow, latest, missing);
    }
    return;
  }

  // 这句话必须同时说清两件事：装完会自动重开（9.1 的 `--force-run` 才让它成立），
  // 以及**数据不会被覆盖**（用户在 2026-11-20 明确要求告知）。文案在
  // lib/shell-locale.js 的 "update.available.body"。
  const choice = await feedback.confirm(parentWindow, latest);
  if (choice.response !== 0) return;

  const tempDir = fs.mkdtempSync(path.join(app.getPath("temp"), "resumeforge-update-"));
  const installerPath = path.join(tempDir, assetName);
  const checksumPath = path.join(tempDir, `${assetName}.sha256`);

  // 188 MB 在慢网下要几分钟，全程无反馈时用户以为卡死（第 9.4 条）：下载期间把进度
  // 推到任务栏图标上，结束（成功或失败）一律清除。
  const { partPath } = await downloadToFile(installer.browser_download_url, installerPath, {
    onProgress: (received, total) => feedback.progress(parentWindow, received, total),
  }).finally(() => feedback.clearProgress(parentWindow));
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

  // 用户在第一次确认时已经授权了"下载 → 校验 → 安装 → 重启"全程；校验通过后
  // **直接安装**，不再弹第二个阻塞确认——用户离开电脑或窗口在托盘里看不见时，那个
  // 确认框会让安装永远不发生（实测缺陷①）。这里只留一条日志记录自动安装的决定。
  if (typeof deps.onAutoInstall === "function") {
    deps.onAutoInstall(installerPath);
  }
  if (typeof deps.installAndQuit === "function") {
    // 第 9.2 条：**拉起安装器之前**先写下"更新尝试"标记。安装进程是脱离的
    // PowerShell（stdio:"ignore"），主进程读不到它的退出码，唯一能判断"装成了没有"
    // 的办法就是下次启动时对账（reconcileUpdateAttempt）。
    // 只在真的会去 spawn 安装器时写：没有 installAndQuit 的调用方只会 app.quit()，
    // 那时写标记会让下次启动误报"更新没有装成"。
    const userDataDir = userDataRoot();
    const recorded = recordUpdateAttempt(userDataDir, {
      from: current,
      to: latest,
      installer: installerPath,
    });
    if (!recorded && typeof deps.logLine === "function") {
      deps.logLine(`update attempt marker not written (userData=${userDataDir || "unknown"})`);
    }
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

// 安装目录里的双击更新入口（Windows update.cmd / macOS update.command）带这个参数启动。
const CHECK_UPDATE_FLAG = "--check-update";

/** 这次启动（或第二个实例的 argv）是不是"双击更新入口"发起的。 */
function wantsManualUpdateCheck(argv = process.argv) {
  return Array.isArray(argv) && argv.includes(CHECK_UPDATE_FLAG);
}

/**
 * 手动检查更新（安装目录里的双击入口带 --check-update 启动时调用）。
 *
 * 与后台定时检查的区别只有两点：立刻查、以及**必须给一个可见的结果**。双击之后什么都
 * 不发生，用户无法区分"没有新版本"和"坏了"。
 *
 * macOS 没有 NSIS 安装器协议（自动安装链路是 Windows 专用），这里如实引导到发布页，
 * 不假装能静默升级。
 */
function runManualUpdateCheck(parentWindow, logLine, deps = {}) {
  const feedback = createUpdateFeedback({ app, dialog, shell }, { ...deps, logLine });
  if (process.platform !== "win32") {
    feedback.manualMac();
    return;
  }
  checkAndOfferUpdate(parentWindow, {
    ...deps,
    // manual：附件缺失时要弹一句"这个版本的安装包还没传全"（自动检查保持安静）。
    // logLine：无论手动还是自动，缺附件都必须在 desktop-main.log 留一条 warning。
    manual: true,
    logLine,
    onUpToDate: () => feedback.upToDate(parentWindow, app.getVersion()),
  }).catch((err) => {
    if (logLine) logLine(`manual update check failed: ${err}`);
    feedback.errorBox(err && err.message ? err.message : String(err));
  });
}

function scheduleUpdateCheck(parentWindow, logLine, deps = {}) {
  if (!app.isPackaged) return;
  if (process.platform !== "win32") return;
  const feedback = createUpdateFeedback({ app, dialog, shell }, { ...deps, logLine });
  // 启动对账（第 9.2 条）：上一次更新"下载校验都过了但没装成"的话，这一次启动要告诉
  // 用户。放在这里而不是 main.js——本函数就是"这次启动的更新入口"，main.js 因此一行
  // 都不用加（它贴着 500 行预算）。失败也不弹错误：对账失败不该污染启动流程。
  void feedback.reconcile(parentWindow).catch((err) => {
    if (logLine) logLine(`update attempt reconcile failed: ${err}`);
  });
  // 校验通过即自动安装是这次的新行为：记一条日志，方便从 desktop-main.log
  // 回答"到底有没有尝试安装"。
  const wiredDeps = {
    ...deps,
    // 后台检查保持安静（不弹窗），但缺附件这件事必须留在日志里，否则"为什么一直不更新"
    // 在 desktop-main.log 里查不到任何线索。
    logLine,
    manual: false,
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
  CHECK_UPDATE_FLAG,
  wantsManualUpdateCheck,
  runManualUpdateCheck,
  scheduleUpdateCheck,
  checkAndOfferUpdate,
  versionCompare,
  timeoutSignal,
  downloadToFile,
  // 第 9.1 条起命令构造在 lib/installer-command.js；这里 re-export，
  // main.js 与 quit-lifecycle 的注入点因此一行都不用改。
  installerWaitCommand,
  MAX_DOWNLOAD_BYTES,
  isReleaseAssetUrl,
  normalizedReleaseVersion,
};
