// SPDX-License-Identifier: Apache-2.0
"use strict";

// 更新包的"下载执行层"：AbortSignal 构造、带停滞看门狗的流式落盘、SHA-256 复验。
//
// 2026-11-21 从 `updater.js` 搬出（那边 497 行贴住 500 行预算，`desktop/**/*.js` 与
// 后端同一档、零豁免）。这一层与"什么时候该下 / 下完要不要装"完全无关：它只认一个
// URL、一个目标路径和几个预算参数，所以可以离线断言（`scripts/test-updater.js` 的
// downloadToFile 用例跑的就是这里）。
//
// 契约（改了就是大面积红）：
//   * `updater.js` 仍然 `module.exports` 出 `timeoutSignal` / `downloadToFile` /
//     `MAX_DOWNLOAD_BYTES`——调用方与用例都从 updater 取，不从本模块取；
//   * 本模块**不得** require `updater.js`（会成环）。出网只经过 `lib/update-net.js`
//     的 `fetchAllowed`（系统代理 + 逐跳白名单的唯一实现），这里不碰 `electron`。

const crypto = require("crypto");
const fs = require("fs");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
// 资产下载**必须**走 fetchAllowed 的 follow 模式（原因见 lib/update-net.js 与下面的
// downloadToFile 注释），并且只有它能拿到系统代理下的 `net.fetch`。
const { fetchAllowed } = require("./update-net");

// 整程上限只做兜底：190MB 在 320KB/s 以下要跑过 10 分钟，"整程 10 分钟"会把慢链路
// 判成失败（本机上行实测 126KB/s ≈ 25 分钟）。真正判断"卡死"的是下面的停滞超时。
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;
// 连续这么久没有收到任何字节 = 停滞。45 秒足够区分"慢"与"死"。
const STALL_TIMEOUT_MS = 45_000;
// The NSIS installer is tens of MB; anything approaching this cap is a
// misrouted or hostile response, not an update.
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

// Electron 33 embeds Node 20, where AbortSignal.timeout exists (the backend
// health probe already relies on it). The manual controller is a fallback for
// exotic runtimes only.
//
// 留在本模块而不是 updater.js：元数据请求（fetchLatestRelease）与下载的整程兜底都用它，
// 两边必须是同一份实现——回退分支写错一次，两处都要各查一遍。
function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref();
  return controller.signal;
}

/** 分块算文件的 SHA-256（安装包几十 MB，不能整份读进内存）。 */
async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** 停滞错误。`code: "STALL"` 是调用方唯一用来区分"卡住"与"网络坏了"的依据。 */
function makeStallError(stallTimeoutMs, phase = "bytes") {
  return Object.assign(new Error(`download stalled: no ${phase} for ${stallTimeoutMs} ms`), {
    code: "STALL",
  });
}

// Bounded streaming download: the payload lands in `<dest>.part`; the caller verifies the
// checksum before renaming it over `dest`. Any failure removes the staging file and leaves
// `dest` untouched.
//
// `onProgress(received, total)`（第 9.4 条）：188 MB 的安装包在慢网下要几分钟，
// 全程没有任何反馈时用户以为卡死了。回调按**百分比变化**节流（每 1% 一次），
// 不是每个 64KB 块一次——任务栏进度条不需要更细的粒度。`total` 为 0（服务端没给
// Content-Length）时不回调：那时算不出比例，宁可不动，也不要拿"0%"骗人。
//
// `stallTimeoutMs` 可注入：停滞用例要毫秒级验证，不能真等 45 秒。
async function downloadToFile(
  url,
  destPath,
  { maxBytes = MAX_DOWNLOAD_BYTES, onProgress, stallTimeoutMs = STALL_TIMEOUT_MS } = {},
) {
  // 停滞有两段，同一口径：① 拿响应头（本段）——代理接受连接却永不回响应头时，只靠 60
  // 分钟的整程上限等于不设防（QA 实测 3 秒内没有任何中止迹象）；② 收正文（看门狗）。
  // 两段都抛 `code: "STALL"`，runManualUpdateCheck 的 stallBox 分支因此能直接复用。
  const headerPhase = new AbortController();
  let headerError = null;
  const headerTimer = setTimeout(() => {
    headerError = makeStallError(stallTimeoutMs, "response headers");
    headerPhase.abort(headerError);
  }, stallTimeoutMs);
  headerTimer.unref?.();
  // controller 服务 ②（看门狗）；timeoutSignal 只做整程兜底。
  const controller = new AbortController();
  // 资产下载**必须** follow：net.fetch 在 redirect:"manual" 下遇 302 直接抛 `Redirect was
  // cancelled`（electron#43715，stale 关闭、无确认修复；QA 在 45.3.2 上实测复发），而
  // github.com → release-assets 这一跳必然发生。放宽的只有"跟随"：初始 URL 仍被
  // isReleaseAssetUrl 钉死到本仓库本 Release 的确切文件名，落地后还要过 .sha256 校验
  // （侧车同样来自钉死的 URL）。详见 lib/update-net.js 的 fetchAllowed。
  let response;
  try {
    response = await fetchAllowed(url, {
      redirectMode: "follow",
      // 三个信号并存：停滞 ②、拿头预算 ①、整程上限。拿到头之后**撤掉** ① 的计时器
      // （见 finally）——留着它会让 45 秒把一个正常传输中的正文打断。
      signal: AbortSignal.any([
        controller.signal,
        headerPhase.signal,
        timeoutSignal(DOWNLOAD_TIMEOUT_MS),
      ]),
    });
  } catch (err) {
    // abort 会让底层报它自己的 AbortError：停滞语义必须优先，否则用户看到通用失败。
    throw headerError || err;
  } finally {
    clearTimeout(headerTimer);
  }
  // 兜底：万一将来的 Fetch 实现又回到"opaque redirect"语义（status 0、头全空），
  // 这里给一句能看懂的话，而不是让用户看到 `download returned 0`。
  if (response.status === 0 || response.type === "opaqueredirect") {
    throw new Error(
      "update download got an opaque redirect; the fetch implementation followed the old manual-redirect semantics",
    );
  }
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
      // 收到字节就是"还活着"：把停滞计时器往后推（看门狗在下面的下载流建好后装配）。
      armStallTimer();
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
  const out = fs.createWriteStream(partPath, { flags: "wx" });

  // 停滞看门狗：连续 stallTimeoutMs 收不到任何字节 = 卡死（代理半通、连接假活）。
  // 两个出口缺一不可——controller.abort 让真实 fetch 收手，out.destroy 让**不响应
  // signal** 的实现（用例替身、自定义流）也退出 pipeline，否则 pipeline 会永远等一个
  // 不会到来的 data 事件。计时器 unref：卡住的进程不该因为看门狗而退不出去。
  let stallTimer = null;
  let stallError = null;
  const armStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stallError = makeStallError(stallTimeoutMs);
      controller.abort(stallError);
      out.destroy(stallError);
    }, stallTimeoutMs);
    stallTimer.unref?.();
  };
  armStallTimer();
  try {
    // pipeline propagates ENOSPC/permission/open errors and aborts all streams;
    // waiting only for "drain" would hang forever after a filesystem error.
    await pipeline(bodyStream, limiter, out);
  } catch (err) {
    // abort 会让 body 流先报它自己的错（"The operation was aborted"）：停滞语义必须
    // 原样传到调用方，否则用户看到的是通用网络失败而不是"下载没有进展"。
    const failure = stallError || err;
    // 清理条件是"文件在不在"，不是"open 事件来没来"：中止可能发生在 open 投递之前，
    // 那样按事件标志判断就会漏删，留下一个 0 字节 `.part`——正是用户在 %TEMP% 里看到
    // 的那种残留。这个路径只可能是我们自己的暂存文件（dest 在每次尝试的临时目录里）。
    if (fs.existsSync(partPath)) {
      try { fs.rmSync(partPath, { force: true }); } catch {}
    }
    throw failure;
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
  return { partPath, size: received };
}

module.exports = {
  MAX_DOWNLOAD_BYTES,
  downloadToFile,
  sha256File,
  timeoutSignal,
};
