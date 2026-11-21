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
// 2026-11-21 第三轮：下载执行层（AbortSignal / 停滞看门狗 / 流式落盘 / SHA-256）
// -> lib/update-download.js，同样为行数预算；四个公开名仍从本文件 re-export。

// 本文件不直接出网：net.fetch 全在 lib/update-net.js，所以这里不取 `net`。
const { app, dialog, shell } = require("electron");
const fs = require("fs");
const path = require("path");
// 下载执行层：signal 构造、流式落盘（含停滞看门狗）、SHA-256 复验。
const { MAX_DOWNLOAD_BYTES, downloadToFile, sha256File, timeoutSignal } = require("./lib/update-download");
// 用户可见的对话框 / 进度条 / 启动对账（第 9.2 9.3 9.4 条）。
const { createUpdateFeedback } = require("./lib/update-feedback");
// 安装器命令（第 9.1 条）：本文件 re-export，main.js 与 quit-lifecycle 的入口不变。
const { installerWaitCommand: powershellWaitCommand } = require("./lib/installer-command");
// 更新尝试标记（第 9.2 条）：纯文件读写，不 require("electron")，可离线断言。
const { clearUpdateAttempt, reconcileUpdateAttempt, recordUpdateAttempt } = require("./lib/update-attempt");
const { createDesktopUpdateSession } = require("./lib/desktop-update-session");
// 发布元数据的纯函数（版本比较 / 资产 URL 归属 / 挑资产）。2026-11-21 搬出本文件，
// 腾出 500 行预算给"系统代理"与"下载停滞"两处修复；名字仍从这里 re-export。
const {
  findAsset,
  isReleaseAssetUrl,
  normalizedReleaseVersion,
  versionCompare,
} = require("./lib/update-release");
// 出网层（白名单 fetch / 系统代理 / 重定向模式）。见该文件头：manual 逐跳校验给元数据，
// follow 给资产下载（net.fetch 在 manual 下遇 302 会抛 Redirect was cancelled）。
const { fetchAllowed } = require("./lib/update-net");

const RELEASES_API = "https://api.github.com/repos/magicapple123/ResumeForge/releases/latest";
const METADATA_TIMEOUT_MS = 15_000;
const CHECK_DELAY_MS = 30_000;
// 启动后的一次检查可能赶上机器离线（Wi-Fi 未连、VPN 未拨）：之后每 6 小时补查
// 一次，失败静默记日志。unref 保证定时器不会阻止应用退出。
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Windows PowerShell 5.1 can exit 0 without executing any script when it is
// itself started with DETACHED_PROCESS. cmd.exe survives detachment and starts
// PowerShell as a regular child. Only fixed switches and a UTF-16LE argument
// pass through cmd, so installer paths (including %, &, spaces and Unicode)
// never become command-interpreter syntax. /d ignores command-processor AutoRun.
function installerWaitCommand(installerPath, mainPid) {
  const { args } = powershellWaitCommand(installerPath, mainPid);
  // NSIS asks Explorer to open its Start-menu shortcut. A stale shortcut can
  // open a different installation. Wait for the actual setup exit, then use
  // the original executable only if the expected version is on disk and that
  // exact installation hasn't already restarted.
  const version = /^ResumeForge-Setup-(\d+\.\d+\.\d+)\.exe$/i.exec(path.win32.basename(installerPath))?.[1];
  const executable = process.execPath.replace(/'/g, "''");
  const confirmRelaunch = version ? [
    `$exe='${executable}'`,
    `$installed=(Get-Item -LiteralPath $exe -ErrorAction Stop).VersionInfo.ProductVersion`,
    `if ($installed -notin @('${version}','${version}.0')) { exit 1 }`,
    "$name=[IO.Path]::GetFileNameWithoutExtension($exe)",
    "for ($i=0; $i -lt 10; $i++) { if (Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) { exit 0 }; Start-Sleep -Milliseconds 300 }",
    "Start-Process -FilePath $exe",
  ] : [];
  const script = [args.at(-1) + " -PassThru | ForEach-Object { $_.WaitForExit(); if ($_.ExitCode -ne 0) { exit $_.ExitCode } }",
    ...confirmRelaunch].join("; ");
  const command = Buffer.from(script, "utf16le").toString("base64");
  const system32 = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32");
  return {
    file: path.win32.join(system32, "cmd.exe"),
    args: ["/d", "/v:off", "/c", "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", command],
  };
}

async function fetchLatestRelease() {
  const response = await fetchAllowed(RELEASES_API, {
    signal: timeoutSignal(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`releases/latest returned ${response.status}`);
  return response.json();
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

// 同一时刻只允许一次更新流程：连点两次「立即更新」会并发两个下载（2026-11-21 实测
// 留下两个 0 字节的 .part 目录，用户还多看到了两张确认框）。重复调用复用进行中的
// 那一次；无论成功、失败还是抛出，`.finally` 都会把锁复位，不会永久卡住。
let updateInFlight = null;
// 在飞的那一次是不是用户手动发起的。只用来判断"能不能并进去"，见下面的分支。
let updateInFlightManual = false;
function checkAndOfferUpdate(parentWindow, deps = {}) {
  const wantManual = Boolean(deps.manual);
  if (updateInFlight) {
    // 后台定时检查（`manual: false`，启动 30 秒后首次、之后每 6 小时）在飞时用户点了
    // 「立即更新」：**不能**让他并进那次后台流程。后台的结论若是「已是最新」，它按设计
    // 一声不响（deps.onUpToDate 只有手动那次才给），用户看到的就是"点了没反应"——
    // 2.2.2 刚修掉的症状会从这里复发。等它收场（无论成败）再自己走一遍。
    // `.catch(() => {})`：上一次失败了也不能让这次手动检查跟着 rejected。
    if (wantManual && !updateInFlightManual) {
      return updateInFlight.catch(() => {}).then(() => checkAndOfferUpdate(parentWindow, deps));
    }
    // 其余组合照旧复用：手动在飞时后台不必插队（它有 6 小时后的下一次），
    // 手动撞手动就是"连点两次不并发"。递归只有一层——await 之后 updateInFlight 必为
    // null，再进来走的就是新建分支。
    return updateInFlight;
  }
  updateInFlightManual = wantManual;
  const flight = runUpdateFlow(parentWindow, deps).finally(() => {
    updateInFlight = null;
    updateInFlightManual = false;
  });
  updateInFlight = flight;
  return flight;
}

async function runUpdateFlow(parentWindow, deps = {}) {
  if (!app.isPackaged) return;
  // This installer protocol is NSIS/Windows only. Other platforms retain their supported manual update path.
  if (process.platform !== "win32") return;
  // 用户可见的一切（对话框文案 / 语言 / 进度条）都从这里出（第 9.3 9.4 条）。
  const feedback = createUpdateFeedback({ app, dialog, shell }, deps);
  const offer = await inspectRelease();
  const { current, latest, missing } = offer;
  if (offer.upToDate) {
    if (deps.onUpToDate) await deps.onUpToDate(current, latest);
    return;
  }
  if (missing) {
    if (deps.logLine) deps.logLine(`update assets incomplete for ${latest}: missing ${missing}`);
    if (deps.manual) await feedback.incomplete(parentWindow, latest, missing);
    return;
  }
  const choice = await feedback.confirm(parentWindow, latest);
  if (choice.response === 0) await installOffer(offer, parentWindow, deps);
}

async function inspectRelease() {
  const release = await fetchLatestRelease();
  const latest = normalizedReleaseVersion(release.tag_name);
  const current = normalizedReleaseVersion(app.getVersion());
  if (!latest || !current) throw new Error("release version is not an exact stable semver");
  if (versionCompare(latest, current) <= 0) {
    return { current, latest, upToDate: true, published: String(release.published_at || "").slice(0, 64) };
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
  return { current, latest, assetName, installer, checksum,
    missing: !installer ? assetName : !checksum ? checksumName : "",
    size: Number.isSafeInteger(installer?.size) && installer.size > 0 ? installer.size : null,
    published: String(release.published_at || "").slice(0, 64), notes: String(release.body || "").slice(0, 131072) };
}

async function installOffer(offer, parentWindow, deps, report = () => {}) {
  const { assetName, installer, checksum, current, latest } = offer;
  const feedback = createUpdateFeedback({ app, dialog, shell }, deps);
  const tempDir = fs.mkdtempSync(path.join(app.getPath("temp"), "resumeforge-update-"));
  const installerPath = path.join(tempDir, assetName);
  const checksumPath = path.join(tempDir, `${assetName}.sha256`);

  // 188 MB 在慢网下要几分钟，全程无反馈时用户以为卡死（第 9.4 条）：下载期间把进度
  // 推到任务栏图标上，结束（成功或失败）一律清除。
  const { partPath } = await downloadToFile(installer.browser_download_url, installerPath, {
    onProgress: (received, total) => {
      feedback.progress(parentWindow, received, total);
      report({ phase: "downloading", received, total });
    },
  }).finally(() => feedback.clearProgress(parentWindow));
  report({ phase: "verifying" });
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
    report({ phase: "installing" });
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

function buildInAppUpdater(getWindow, deps, log) {
  if (!app.isPackaged || process.platform !== "win32") return null;
  return createDesktopUpdateSession({
    current: app.getVersion(), inspect: inspectRelease, log,
    install: (offer, report) => installOffer(offer, getWindow(), { ...deps, logLine: log }, report),
    publish: state => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send("desktop:update-state", state);
    },
  });
}

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
 * 非 Windows 平台没有 NSIS 安装器协议（自动安装链路是 Windows 专用），这里如实引导到
 * 发布页，不假装能静默升级。**文案按平台分**（macOS: .dmg / Linux: AppImage），判定在
 * lib/update-feedback.js 的 manualPlatform —— 它从 `deps.platform || process.platform`
 * 读平台，所以这条出口既能服务两个平台，也能被用例覆盖。
 */
function runManualUpdateCheck(parentWindow, logLine, deps = {}) {
  if (deps.inApp) return deps.inApp.check(true);
  const feedback = createUpdateFeedback({ app, dialog, shell }, { ...deps, logLine });
  if (process.platform !== "win32") {
    feedback.manualPlatform();
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
    // 停滞要单独说：只说"检查更新失败"会让用户以为是没网或域名被拦，而真正发生的是
    // "连上了、响应头也拿到了，但正文一个字节都不来"（代理环境里的典型形态）。
    if (err && err.code === "STALL") feedback.stallBox();
    else feedback.errorBox(err && err.message ? err.message : String(err));
  });
}

function scheduleUpdateCheck(parentWindow, logLine, deps = {}) {
  if (!app.isPackaged) return;
  if (process.platform !== "win32") return;
  if (deps.inApp) {
    const dir = userDataRoot();
    const previous = reconcileUpdateAttempt(dir, app.getVersion());
    if (previous.status === "failed") {
      deps.inApp.interrupted(previous.attempt.to);
      clearUpdateAttempt(dir);
    } else {
      setTimeout(() => {
        if (deps.inApp.snapshot().phase === "idle") void deps.inApp.check(false);
      }, CHECK_DELAY_MS).unref();
    }
    setInterval(() => void deps.inApp.check(false), RECHECK_INTERVAL_MS).unref();
    return;
  }
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
  buildInAppUpdater,
  CHECK_UPDATE_FLAG,
  wantsManualUpdateCheck,
  runManualUpdateCheck,
  scheduleUpdateCheck,
  checkAndOfferUpdate,
  versionCompare,
  // 下载执行层（lib/update-download.js）的出口在这里 re-export：调用方（含用例）
  // 仍从 updater 取，main.js 与 scripts/test-updater*.js 的入口因此一行都不用改。
  timeoutSignal,
  // lib/update-net.js 的出口在这里 re-export：调用方（含用例）仍从 updater 取。
  fetchAllowed,
  downloadToFile,
  // 第 9.1 条起命令构造在 lib/installer-command.js；这里 re-export，
  // main.js 与 quit-lifecycle 的注入点因此一行都不用改。
  installerWaitCommand,
  MAX_DOWNLOAD_BYTES,
  isReleaseAssetUrl,
  normalizedReleaseVersion,
};
