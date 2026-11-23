// SPDX-License-Identifier: Apache-2.0
"use strict";

// 「额度用尽时的备用探测」：读 `github.com/<repo>/releases/latest` 的 302，拿到最新 tag。
// 全程不碰 `api.github.com`、不消耗 API 额度、不读任何 HTML 正文。
//
// 为什么单独成文件：`desktop/**/*.js` 有 500 行硬预算（test_file_size_budget.py，零豁免），
// 而这段逻辑（怎么跟那一跳 302、怎么从地址里取 tag、什么地址不许认）与"什么时候该检查
// 更新"完全不耦合，可以独立断言。`updater.js` 只留一句 `fetchLatestTagViaRedirect(...)`。
//
// 安全边界（与 `lib/update-net.js` 同一套，没有放宽）：
//   - 起始地址是模块常量（`github.com`，本来就在 `ALLOWED_HOSTS` 里）；
//   - `location` **只用来解析 tag**，绝不拿它去发请求；它的 host 仍要过同一份白名单
//     （防的是"上游把我们指向别的主机"那一类形态）；
//   - 拿到的 tag 还要过 `updater.js` 的 `normalizedReleaseVersion`，非标准版本号直接失败。
const { ALLOWED_HOSTS, networkFetch } = require("./update-net");
const { timeoutSignal } = require("./update-download");

const TAG_MARKER = "/releases/tag/";

/** 备用探测的入口地址（发布页 `/releases/latest` 会 302 到具体 tag）。 */
function releasesRedirectUrl(repo) {
  return `https://github.com/${repo}/releases/latest`;
}

/**
 * 地址必须落在 `ALLOWED_HOSTS` 内的 https 主机上。
 *
 * 白名单只有一份（`lib/update-net.js` 的 `ALLOWED_HOSTS`）；这里复述的是它 `fetchAllowed`
 * 里的同一套判据，因为备用探测必须自己读 302 的 `location`（`fetchAllowed` 会把那一跳
 * 吃掉、只交回最终响应），所以也得自己把这道闸门带上。
 */
function assertAllowedReleaseUrl(url) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_HOSTS.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new Error(`update host not allowed: ${parsed.hostname}`);
  }
  return parsed;
}

/** 从 `https://github.com/<repo>/releases/tag/<tag>` 里取 tag，取不到返回空串。 */
function tagFromReleaseUrl(url) {
  const text = String(url || "");
  const markerAt = text.indexOf(TAG_MARKER);
  if (markerAt < 0) return "";
  const rest = text.slice(markerAt + TAG_MARKER.length).split(/[?#]/)[0];
  try {
    return decodeURIComponent(rest).replace(/\/+$/, "");
  } catch {
    // 非法百分号转义（`%E0%A4%A` 这类）：原样用，后面还有 semver 校验兜底。
    return rest.replace(/\/+$/, "");
  }
}

/**
 * 取最新 tag（形如 `v2.3.2`）；拿不到就抛错，由调用方决定怎么措辞。
 *
 * @param {{repo: string, timeoutMs: number}} options
 * @returns {Promise<string>}
 */
async function fetchLatestTagViaRedirect({ repo, timeoutMs }) {
  const url = releasesRedirectUrl(repo);
  const headers = { Accept: "text/html" };
  let response;
  try {
    // manual：302 的 location 只有自己去看才拿得到。
    response = await networkFetch(url, { redirect: "manual", headers, signal: timeoutSignal(timeoutMs) });
  } catch (err) {
    // electron#43715（依据见 lib/update-net.js 的注释）：net.fetch 在 redirect:"manual"
    // 下遇到 302 可能直接抛 `Redirect was cancelled`。那时退回 follow，用 response.url
    // 取最终地址——多一次请求，但备用探测只在主路径已经失败时才跑。
    if (!/redirect was cancelled/i.test(String((err && err.message) || err))) throw err;
    response = await networkFetch(url, { redirect: "follow", headers, signal: timeoutSignal(timeoutMs) });
  }
  const location =
    response.headers && typeof response.headers.get === "function"
      ? response.headers.get("location")
      : "";
  const candidate = location || response.url || "";
  if (candidate) {
    assertAllowedReleaseUrl(candidate);
    const tag = tagFromReleaseUrl(candidate);
    if (tag) return tag;
  }
  // 没有 Release 时 GitHub 会 302 到 `/releases` 列表页（没有 tag 段）——与"备用也失败"
  // 同一个出口：状态码进 errorDetail，用户至少能看到是哪一跳没成。
  throw new Error(`releases/latest redirect returned ${response.status}`);
}

module.exports = {
  TAG_MARKER,
  assertAllowedReleaseUrl,
  fetchLatestTagViaRedirect,
  releasesRedirectUrl,
  tagFromReleaseUrl,
};
