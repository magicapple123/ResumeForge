// SPDX-License-Identifier: Apache-2.0
"use strict";

// 发布元数据的纯函数：版本号解析与比较、资产 URL 归属校验、按谓词挑资产。
//
// 2026-11-21 从 updater.js 搬出。原因是 updater.js 贴着 500 行预算
// （backend/tests/test_file_size_budget.py，零豁免），而这一天要往里加两样东西：
// 走系统代理的 fetch（Node 的 fetch 在代理环境下收不到任何字节）与下载停滞看门狗。
// 本文件没有任何 I/O，也不 require("electron")，可以离线直接断言。
// updater.js 仍 re-export 这几个名字，外部契约不变。

const RELEASE_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

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

function findAsset(release, predicate) {
  return (release.assets || []).find(predicate);
}

module.exports = {
  RELEASE_VERSION_RE,
  versionCompare,
  normalizedReleaseVersion,
  isReleaseAssetUrl,
  findAsset,
};
