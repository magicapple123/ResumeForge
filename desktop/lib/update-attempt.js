// SPDX-License-Identifier: Apache-2.0
"use strict";

// 「更新尝试」标记 + 下次启动对账（2026-11-20，第 9.2 条）。
//
// 为什么需要它：拉起 NSIS 安装器的是一个**脱离的**PowerShell 等待进程
// （lib/quit-lifecycle.js::spawnPendingInstaller 用 detached + stdio:"ignore"），主进程拿不到
// 也检查不了它的退出码。安装失败时用户看到的现象只有"应用关了，再也没起来"，
// 日志里也只有一条 install-spawned。
//
// 为什么不用 `Start-Process -Wait -PassThru` 读退出码（评估后否决）：
//   1. `-Wait` 会等整棵进程树；9.1 修好 `--force-run` 之后，NSIS 装完会把应用拉起来，
//      PowerShell 有被新进程挂住的风险；
//   2. 退出码 0 也可能是"装完了但应用没起来"——那类失败读退出码永远看不到。
//
// 所以改用**标记法**：拉起安装器**之前**写一份 {from,to,at,installer}，下次启动对账：
//   * `app.getVersion()` 仍是 `from` → 这次真的没装成，告诉用户（见 updater.js 的
//     reconcileUpdateAttempt：手动下载 / 打开日志 / 知道了）；
//   * 版本号变了（=== to 或更新，甚至是被手动装成别的版本）→ 删掉标记，静默。
//
// 标记必须落在**用户目录**：安装目录是只读契约（electron-builder.yml 的 nsis 段），
// 往那儿写只会 EPERM。路径由调用方用 `app.getPath("userData")` 传进来，本模块不
// 硬编码 %APPDATA%，也不 require("electron")——离线用例可以直接拿临时目录断言。
//
// 所有读写都吞异常并返回状态：一个诊断标记绝不该把启动或更新流程拦下来。

const fs = require("node:fs");
const path = require("node:path");

/** 标记文件名。放 userData 根目录（与 data/ 同级），便于用户按路径贴给维护者。 */
const ATTEMPT_FILE_NAME = "update-attempt.json";

/** 对账结论：没试过 / 没装成 / 已经装成了（含"版本已变"）。 */
const ATTEMPT_STATUS = Object.freeze({
  none: "none",
  failed: "failed",
  installed: "installed",
});

/**
 * @param {string} userDataDir `app.getPath("userData")`
 * @returns {string} 标记文件的绝对路径
 */
function attemptFilePath(userDataDir) {
  return path.join(String(userDataDir), ATTEMPT_FILE_NAME);
}

/**
 * 写标记。**必须在拉起安装器之前调用**（写完才 app.quit() → before-quit → spawn）。
 *
 * 写失败只返回 false：更新流程本身不该因为"记不下来"而中止。
 *
 * @param {string} userDataDir `app.getPath("userData")`
 * @param {{from: string, to: string, at?: string, installer?: string}} attempt
 * @returns {boolean} 是否写成功
 */
function recordUpdateAttempt(userDataDir, attempt) {
  if (!userDataDir || !attempt) return false;
  const from = typeof attempt.from === "string" ? attempt.from.trim() : "";
  const to = typeof attempt.to === "string" ? attempt.to.trim() : "";
  // from/to 缺一个就没有对账依据，宁可不写（下次启动也就不会误报）。
  if (!from || !to) return false;
  const payload = {
    from,
    to,
    at: typeof attempt.at === "string" && attempt.at ? attempt.at : new Date().toISOString(),
    installer: typeof attempt.installer === "string" ? attempt.installer : "",
  };
  try {
    fs.mkdirSync(String(userDataDir), { recursive: true });
    fs.writeFileSync(attemptFilePath(userDataDir), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 读标记。
 *
 * @param {string} userDataDir
 * @returns {{from: string, to: string, at: string, installer: string} | null}
 *   文件不存在、读不了、不是合法 JSON、缺 from/to 一律 null（对账按"没试过"处理）。
 */
function readUpdateAttempt(userDataDir) {
  if (!userDataDir) return null;
  let raw;
  try {
    raw = fs.readFileSync(attemptFilePath(userDataDir), "utf-8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const from = typeof parsed.from === "string" ? parsed.from.trim() : "";
  const to = typeof parsed.to === "string" ? parsed.to.trim() : "";
  if (!from || !to) return null;
  return {
    from,
    to,
    at: typeof parsed.at === "string" ? parsed.at : "",
    installer: typeof parsed.installer === "string" ? parsed.installer : "",
  };
}

/**
 * 删标记（装成了、或标记本身不可用）。删不掉也不抛。
 *
 * @param {string} userDataDir
 * @returns {boolean} 删除后文件确实不存在
 */
function clearUpdateAttempt(userDataDir) {
  if (!userDataDir) return true;
  try {
    fs.rmSync(attemptFilePath(userDataDir), { force: true });
  } catch {
    // 删不掉就是多一次误报，不影响使用。
  }
  try {
    return !fs.existsSync(attemptFilePath(userDataDir));
  } catch {
    return true;
  }
}

/**
 * 对账：这次启动能不能说明"上一次更新没装成"。
 *
 * 判定只有三条（全部按 `app.getVersion()` 的字符串相等比较，不解析 semver：
 * 这里要回答的是"是不是同一份安装"，不是"哪个更新"）：
 *   * 没有标记 / 标记不可读 → none（什么都不做）；
 *   * 版本仍是 `from` → failed（标记保留，由调用方弹完提示再 clear）；
 *   * 版本已不是 `from` → installed（**立即**删标记，静默）。
 *
 * 第三条把"装成了""手动装了别的版本""用户回滚了"都归进同一个桶：只要版本变了，
 * 这条标记就不再描述现实，留着只会在下次启动误报。
 *
 * @param {string} userDataDir `app.getPath("userData")`
 * @param {string} currentVersion `app.getVersion()`
 * @returns {{status: "none" | "failed" | "installed", attempt: object | null}}
 */
function reconcileUpdateAttempt(userDataDir, currentVersion) {
  const attempt = readUpdateAttempt(userDataDir);
  if (!attempt) {
    // 文件在但内容坏了：顺手删掉，别让它一直躺在用户目录里。
    clearUpdateAttempt(userDataDir);
    return { status: ATTEMPT_STATUS.none, attempt: null };
  }
  const current = typeof currentVersion === "string" ? currentVersion.trim() : "";
  if (current && current === attempt.from) {
    return { status: ATTEMPT_STATUS.failed, attempt };
  }
  clearUpdateAttempt(userDataDir);
  return { status: ATTEMPT_STATUS.installed, attempt };
}

module.exports = {
  ATTEMPT_FILE_NAME,
  ATTEMPT_STATUS,
  attemptFilePath,
  clearUpdateAttempt,
  readUpdateAttempt,
  reconcileUpdateAttempt,
  recordUpdateAttempt,
};
