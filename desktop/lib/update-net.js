// SPDX-License-Identifier: Apache-2.0
"use strict";

// 更新器的出网层：白名单 fetch（逐跳校验 / 自动跟随两种模式）+ 走系统代理的实现。
//
// 2026-11-21 从 updater.js 搬出。两个原因：
//   1. `desktop/**/*.js` 受 500 行预算（backend/tests/test_file_size_budget.py，零豁免），
//      而这一天要加的"下载改用 redirect: follow"把它顶破了；
//   2. "怎么出网"和"什么时候更新"是两件事：本文件不碰 fs、不碰对话框、不做版本判断，
//      只回答"这个地址能不能请求、怎么跟跳转"。
// updater.js 仍 re-export `fetchAllowed`，外部契约不变。

const { net } = require("electron");

// Every host we are willing to touch, including redirect hops.
const ALLOWED_HOSTS = new Set([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

// 走系统代理的 fetch。Node 的 fetch（undici）既不读系统代理也不读 HTTP(S)_PROXY：
// 代理环境里它照样连上 CDN、拿到响应头，正文一个字节都不来（2026-11-21 实测：
// HTTP 206 + 20 秒 0 字节，用户看到的是一张"点了没反应"的对话框）。net.fetch 走
// Chromium 网络栈，系统代理 / PAC / WPAD / 认证代理都由它接管。离线用例的 electron
// 桩没有 net，回落全局 fetch——那里 fetch 本身也是桩，一次网络都不会发。
function networkFetch(input, init) {
  if (net && typeof net.fetch === "function") return net.fetch(input, init);
  return fetch(input, init);
}

/**
 * 请求一个**只允许落在 ALLOWED_HOSTS** 的地址。
 *
 * `redirectMode` 决定"遇到 3xx 怎么办"，两种模式各有不可替代的理由：
 *
 * - `manual`（默认，元数据用）：自己跟随每一跳，每跳都过 ALLOWED_HOSTS。发布元数据
 *   能把我们指向哪台主机，靠的就是这道闸门。
 * - `follow`（资产下载用）：**必须**，不是放松。electron#43715 实测 `net.fetch` 在
 *   `redirect: "manual"` 下遇到 302 会直接抛 `Error: Redirect was cancelled`（维护者
 *   承认"might be a bug"，issue 带 stale 标签关闭、没有确认修复；我们装的 45.3.2 不能
 *   假定已修）。而 `github.com/.../releases/download/...` → `release-assets.
 *   githubusercontent.com` 这一跳**必然发生**——用 manual 就是装不上更新。
 *
 * 走 `follow` 时的安全边界没有消失，只是换了把关点：
 *   1. 初始 URL 被 `isReleaseAssetUrl` 钉死到"本仓库、本 tag、确切文件名"，发布元数据
 *      指不到任意主机；
 *   2. 载荷落地后还要过 `.sha256` 校验，而侧车同样只从钉死的本 Release URL 取；
 *   3. 白名单仍然先跑一遍（拦住"元数据里塞了个别的主机"这种形态）。
 *
 * @param {string} url 起始地址
 * @param {{redirectMode?: "manual" | "follow", signal?: AbortSignal,
 *   headers?: Record<string, string>}} [init]
 */
async function fetchAllowed(url, init = {}) {
  const { redirectMode = "manual", ...rest } = init;
  // Manual redirect following: every hop's host must be allowlisted.
  let current = url;
  for (let hop = 0; hop < 10; hop += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) {
      throw new Error(`update host not allowed: ${parsed.hostname}`);
    }
    const response = await networkFetch(current, {
      ...rest,
      redirect: redirectMode,
      headers: {
        "User-Agent": "ResumeForge-Desktop-Updater",
        Accept: "application/vnd.github+json",
        ...(rest.headers ? rest.headers : {}),
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

module.exports = {
  ALLOWED_HOSTS,
  fetchAllowed,
  networkFetch,
};
