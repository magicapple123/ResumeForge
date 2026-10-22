// SPDX-License-Identifier: Apache-2.0
"use strict";

// 原子化更新的文件系统底座（任务 11）。
//
// 现状：更新是"跑一遍 NSIS 覆盖安装"，装到一半失败就只剩半个安装目录，
// 也没有回退路径。这里提供不依赖新库的最小机制，让更新可以先落到
// <runtimeDir>/versions/<version>、校验通过后再切换 <runtimeDir>/current 指针：
//
//   runtimeDir/
//     versions/1.0.3/     <- 完整解包的一份，切换前就绪
//     current             <- 纯文本版本号，指向上面的某个目录
//
// 切换用的是"写临时文件再 rename"：rename 在同一个文件系统上是原子的，
// 因此 current 要么是旧版本、要么是新版本，不会出现空/半个版本号。
//
// 注意：本次**不接线**到现有 NSIS 流程（现有安装器仍是唯一发布路径），
// 这里只把能力与它的失败语义（校验失败不切换、可回滚、可清理）先用测试固化。

const fs = require("fs");
const path = require("path");

const VERSIONS_DIR_NAME = "versions";
const CURRENT_POINTER_NAME = "current";
// 只接受 1.2.3 / 1.2.3-rc.1 / 1.2.3+build.5 这种形态。拒绝 ".."、路径分隔符
// 和任何别的东西：版本号会被直接拼进路径，宽进就是目录穿越。
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version) {
  if (typeof version !== "string" || !VERSION_RE.test(version)) return null;
  if (version.includes("..")) return null;
  if (version.includes("/") || version.includes("\\")) return null;
  const withoutBuild = version.split("+")[0];
  const dashAt = withoutBuild.indexOf("-");
  const core = dashAt === -1 ? withoutBuild : withoutBuild.slice(0, dashAt);
  const prerelease = dashAt === -1 ? "" : withoutBuild.slice(dashAt + 1);
  const parts = core.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  return { parts, prerelease };
}

function assertVersion(version) {
  if (!parseVersion(version)) {
    throw new Error(`非法版本号：${JSON.stringify(version)}（只接受 semver，且不含路径分隔符）`);
  }
  return version;
}

// 语义化比较：先比主版本三元组，再看预发布（正式版 > 预发布版）。
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`无法比较版本号：${left} vs ${right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] - b.parts[index];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

function versionsRoot(runtimeDir) {
  return path.join(runtimeDir, VERSIONS_DIR_NAME);
}

function currentPointerPath(runtimeDir) {
  return path.join(runtimeDir, CURRENT_POINTER_NAME);
}

function versionDir(runtimeDir, version) {
  return path.join(versionsRoot(runtimeDir), assertVersion(version));
}

// 指针文件读不出来 / 内容非法都返回 null：调用方只关心"当前有没有已知版本"，
// 一个坏指针不该让更新流程崩掉。
function readCurrent(runtimeDir) {
  try {
    const value = fs.readFileSync(currentPointerPath(runtimeDir), "utf-8").trim();
    return parseVersion(value) ? value : null;
  } catch {
    return null;
  }
}

// 临时文件名带 pid：两个进程同时切换时各自 rename，最后一次赢，但谁都不会
// 读到别人写了一半的内容。
function writeCurrent(runtimeDir, version) {
  assertVersion(version);
  const pointerPath = currentPointerPath(runtimeDir);
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
  const tmpPath = `${pointerPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, `${version}\n`);
  fs.renameSync(tmpPath, pointerPath);
  return version;
}

// 把 stagingDir 安装成 versions/<version>，再交给 verify 判定是否可用。
// verify 返回假值 = 这一版不可用：删除刚装的目录、抛错，current 保持不动。
async function applyVersion({ runtimeDir, version, stagingDir, verify } = {}) {
  assertVersion(version);
  if (!runtimeDir) throw new Error("applyVersion 需要 runtimeDir");
  if (!stagingDir || !fs.existsSync(stagingDir)) {
    throw new Error(`待安装目录不存在：${stagingDir}`);
  }
  const target = versionDir(runtimeDir, version);
  if (path.resolve(target) === path.resolve(stagingDir)) {
    throw new Error("待安装目录不能就是目标目录");
  }

  fs.mkdirSync(versionsRoot(runtimeDir), { recursive: true });
  // 同一版本重复安装（上一次装到一半）先清干净，避免旧文件混进新版本。
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(stagingDir, target, { recursive: true });

  let verified = true;
  if (typeof verify === "function") {
    try {
      verified = Boolean(await verify(target));
    } catch (err) {
      // 校验本身抛错同样是"这一版不可用"。
      fs.rmSync(target, { recursive: true, force: true });
      throw err;
    }
  }
  if (!verified) {
    fs.rmSync(target, { recursive: true, force: true });
    throw new Error(`版本 ${version} 校验未通过，已回滚到当前版本（current 未改动）`);
  }

  writeCurrent(runtimeDir, version);
  return { version, dir: target };
}

function listInstalledVersions(runtimeDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(versionsRoot(runtimeDir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && parseVersion(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => compareVersions(right, left)); // 新 -> 旧
}

// 回滚：切到"比当前次新的那一个已安装版本"。找不到就抛错，绝不留下一个
// 指向不存在目录的 current。
function rollback({ runtimeDir, currentVersion } = {}) {
  if (!runtimeDir) throw new Error("rollback 需要 runtimeDir");
  const target = typeof currentVersion === "string" ? assertVersion(currentVersion) : readCurrent(runtimeDir);
  const candidates = listInstalledVersions(runtimeDir).filter((version) => version !== target);
  if (candidates.length === 0) {
    throw new Error(`没有可回滚的版本（当前 ${target || "未知"}）`);
  }
  const previous = candidates[0];
  writeCurrent(runtimeDir, previous);
  return { version: previous, from: target };
}

// 只保留最近的 keep 个版本（默认 2：当前 + 上一次，够回滚一次）。
function pruneVersions({ runtimeDir, keep = 2 } = {}) {
  if (!runtimeDir) throw new Error("pruneVersions 需要 runtimeDir");
  const limit = Number.isInteger(keep) && keep >= 1 ? keep : 2;
  const installed = listInstalledVersions(runtimeDir);
  const removed = installed.slice(limit);
  for (const version of removed) {
    fs.rmSync(path.join(versionsRoot(runtimeDir), version), { recursive: true, force: true });
  }
  return { kept: installed.slice(0, limit), removed };
}

module.exports = {
  CURRENT_POINTER_NAME,
  VERSIONS_DIR_NAME,
  applyVersion,
  compareVersions,
  currentPointerPath,
  listInstalledVersions,
  parseVersion,
  pruneVersions,
  readCurrent,
  rollback,
  versionDir,
  versionsRoot,
  writeCurrent,
};
