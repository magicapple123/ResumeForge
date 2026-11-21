// SPDX-License-Identifier: Apache-2.0
"use strict";

// 「发布资产不全」时的桌面行为（2026-11-20；第 8.3 条 + 第 9.3 条之后的接线）。
//
// 两类场景，共三个入口，都在本文件：
//   A. **缺附件**（发布页只有 zip、或只有 exe 没有 .sha256）：
//      - 手动检查（「帮助 → 检查更新」/ 安装目录的 `update.cmd`）→ 必须弹一句，且说清缺哪个文件；
//      - 后台检查 → 一句都不弹（否则每 6 小时弹一次），但日志里必须留痕。
//   B. **资产只带 zip**：桌面什么都不做——不能拿 zip 去覆盖（第 8.3 条）。
//
// 为什么单独一个文件：`desktop/updater.js` 里
//
//   if (deps.manual) await feedback.incomplete(parentWindow, latest, missing);
//
// 是用户手动检查且发布页缺附件时**唯一**看到的那句话。此前 `test-updater.js` 全文没有
// 出现过 `manual`（QA 复核时点出），也就是说把 `deps.manual` 写错、或把这个 `await` 挪走，
// 不会有任何用例变红——而这正是"点了没反应"那类投诉的同一现场。
//
// 文案本身（zh / en 两套）在 scripts/test-update-feedback.js 里测；这里只钉**接线**：
// 什么时候该弹、弹的是哪一个（latest / missing 传没传对）、后台是否安静、
// 以及"只带 zip 时不下载也不安装"。
//
// 与 test-updater.js 的关系：那边受 500 行预算、且只管"下载 → 校验 → 安装"主链，
// 所以这里自带一份最小 harness（VM + electron 桩 + fetch 桩，不联网、不碰打包）。
//
// Run with: node --test scripts/test-updater-manual.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");
// 本文件自己那个 harness 也叫 loadUpdater（构造沙箱），这里只要"在沙箱里求值"那一步。
const { REPO_DESKTOP, loadUpdater: runUpdaterModule } = require("./updater-sandbox");

const APP_VERSION = "0.18.0";
const LATEST = "0.19.0";
const INSTALLER_NAME = `ResumeForge-Setup-${LATEST}.exe`;
/** 同版本的 release：检查在"已是最新"这一支就结束，永远不会走到下载。 */
const UP_TO_DATE_RELEASE = { tag_name: `v${APP_VERSION}`, assets: [] };
const ASSET_URL = `https://github.com/magicapple123/ResumeForge/releases/download/v${LATEST}/${INSTALLER_NAME}`;

/**
 * updater.js 跑在 Node VM 里：electron 与 fetch 都是桩，一次真实网络请求都不会发生。
 *
 * `netStub` 对应 Electron 的 `net`：不传时 `require("electron").net` 是 undefined，
 * updater 会回落全局 fetch（这条回落只服务离线用例，见 networkFetch 的注释）。
 */
function loadUpdater({ fetchImpl, netStub, appLocale = "zh-CN" } = {}) {
  const events = { dialogs: [], errors: [], quit: [] };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rf-updater-manual-"));

  const appStub = {
    isPackaged: true,
    getVersion: () => APP_VERSION,
    quit: () => events.quit.push("quit"),
    getPath: () => tmpRoot,
    getLocale: () => appLocale,
  };
  const dialogStub = {
    showMessageBox: async (...args) => {
      // 有父窗口时是 (parent, options)，没有时是 (options)——两种都收。
      events.dialogs.push(args.length > 1 ? args[1] : args[0]);
      return { response: 1 };
    },
    showErrorBox: (title, message) => events.errors.push({ title, message }),
  };
  const shellStub = {
    openExternal: () => Promise.resolve(),
    openPath: () => Promise.resolve(""),
  };
  const electronStub = { app: appStub, dialog: dialogStub, net: netStub, shell: shellStub };

  const sandbox = {
    console,
    process,
    Buffer,
    Promise,
    Date,
    JSON,
    Error,
    Math,
    Number,
    String,
    Object,
    Array,
    setTimeout,
    clearTimeout,
    setImmediate,
    AbortSignal,
    URL,
    AbortController,
    fetch: fetchImpl,
    // require 由 scripts/updater-sandbox.js 装进来（相对路径也得在沙箱里求值）。
    module: { exports: {} },
    __filename: path.join(REPO_DESKTOP, "updater.js"),
    __dirname: REPO_DESKTOP,
  };

  const exports = runUpdaterModule(sandbox, electronStub);
  return { exports, events, tmpRoot };
}

/** 发布页只传了 half：`assets` 由用例决定缺哪个。 */
function releaseWith(assetNames) {
  return {
    tag_name: `v${LATEST}`,
    assets: assetNames.map((name) => ({
      name,
      browser_download_url: `https://github.com/magicapple123/ResumeForge/releases/download/v${LATEST}/${name}`,
    })),
  };
}

function respondWith(release) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => release,
    body: null,
  });
}

test("手动检查 + 安装包没传全：必须弹一句，且 latest / missing 传对", async () => {
  const loaded = loadUpdater({ fetchImpl: respondWith(releaseWith([`ResumeForge-${LATEST}-windows.zip`])) });
  try {
    await loaded.exports.checkAndOfferUpdate(null, { manual: true });
    assert.equal(loaded.events.dialogs.length, 1, "手动检查必须给一个可见结果，不能一声不响");
    const options = loaded.events.dialogs[0];
    assert.equal(options.message, "这个版本的安装包还没传全");
    // missing 的取值来自 `!installer ? assetName : checksumName`：只带 zip 时缺的是 **exe**。
    assert.match(options.detail, new RegExp(LATEST), "要说明最新版本号");
    assert.match(options.detail, /ResumeForge-Setup-0\.19\.0\.exe/, "要说清缺的是哪一个文件（exe，不是 zip）");
    assert.doesNotMatch(options.detail, /-windows\.zip/, "不能把用户手上的 zip 说成「缺的那个」");
    assert.equal(options.buttons.length, 1, "只有一个「好」，没有需要用户做决定的分支");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("手动检查 + 只缺 sha256 侧车：missing 要报侧车名，不能笼统说「缺安装包」", async () => {
  const loaded = loadUpdater({ fetchImpl: respondWith(releaseWith([INSTALLER_NAME])) });
  try {
    await loaded.exports.checkAndOfferUpdate(null, { manual: true });
    assert.equal(loaded.events.dialogs.length, 1);
    assert.match(
      loaded.events.dialogs[0].detail,
      /ResumeForge-Setup-0\.19\.0\.exe\.sha256/,
      "校验文件缺失和安装包缺失是两件事，报错要指名",
    );
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("后台检查 + 同样缺资产：一句都不弹，但日志里必须留痕", async () => {
  const loaded = loadUpdater({ fetchImpl: respondWith(releaseWith([])) });
  const lines = [];
  try {
    await loaded.exports.checkAndOfferUpdate(null, { manual: false, logLine: (line) => lines.push(line) });
    assert.equal(loaded.events.dialogs.length, 0, "后台检查必须保持安静（否则每 6 小时弹一次）");
    assert.equal(loaded.events.errors.length, 0, "也不该走错误框");
    // updater.js 的 `logLine("update assets incomplete ...")` 此前没有任何断言在盯。
    assert.ok(
      lines.some((line) => /update assets incomplete for 0\.19\.0: missing ResumeForge-Setup-0\.19\.0\.exe/.test(line)),
      `缺附件必须留一条 warning（实际日志：${JSON.stringify(lines)}）`,
    );
    assert.equal(loaded.events.quit.length, 0, "更不允许走到退出/安装");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("英文界面下这句也走 i18n（不是硬编码中文）", async () => {
  const loaded = loadUpdater({
    fetchImpl: respondWith(releaseWith([])),
    appLocale: "en-US",
  });
  try {
    await loaded.exports.checkAndOfferUpdate(null, { manual: true });
    assert.equal(loaded.events.dialogs.length, 1);
    assert.doesNotMatch(loaded.events.dialogs[0].message, /[\u4e00-\u9fa5]/, "英文界面不得出现中文");
    assert.match(loaded.events.dialogs[0].message, /installer is not fully uploaded/i);
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("发布只带 -windows.zip：桌面什么都不做（不弹框 / 不下载 / 不安装）", async () => {
  // 第 8.3 条：控制台与便携版吃 zip，桌面只认 ResumeForge-Setup-<版本>.exe。
  // 拿 zip 覆盖只会换掉 resources/payload、app.asar 留在旧版——半新半旧比不更新更难查。
  let fetches = 0;
  const release = releaseWith([`ResumeForge-${LATEST}-windows.zip`]);
  const loaded = loadUpdater({
    fetchImpl: async () => {
      fetches += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => release,
        body: null,
      };
    },
  });
  try {
    // 后台入口（也是双击 update.cmd 之外最常见的入口）：不允许任何可见动作。
    await loaded.exports.checkAndOfferUpdate(null, { manual: false });
    // 只允许那一次 releases API 请求——第二次就是去下 zip 了。
    assert.equal(fetches, 1, "an incomplete release must never be downloaded");
    assert.equal(loaded.events.dialogs.length, 0, "没有可装的包，一个框都不该弹");
    assert.equal(loaded.events.quit.length, 0, "must not reach the install/quit path");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 系统代理 / 下载停滞 / 单飞锁（2026-11-21）
//
// 三条都对应一个**用户实测到**的缺陷形态，而不是假想的边界：
//   1. 全局 fetch 在系统代理下收不到正文（HTTP 206 + 0 字节）→ 更新静默失败；
//   2. 连接假活时没有任何超时能收场 → 窗口弹出、进度条永远停在 0；
//   3. 连点两次会并发两个下载 → %TEMP% 留下两个 0 字节的 .part 目录。
// ---------------------------------------------------------------------------

test("元数据请求走 net.fetch（Chromium 网络栈才认系统代理）", async () => {
  const netCalls = [];
  let globalFetchCalls = 0;
  const netStub = {
    fetch: async (input, init) => {
      netCalls.push({ input, init });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => UP_TO_DATE_RELEASE,
        body: null,
      };
    },
  };
  const loaded = loadUpdater({
    netStub,
    fetchImpl: async () => {
      globalFetchCalls += 1;
      assert.fail("代理环境里全局 fetch 拿不到正文，不允许再走它");
    },
  });
  try {
    await loaded.exports.checkAndOfferUpdate(null, {});
    assert.equal(netCalls.length, 1, "releases 元数据必须走 net.fetch");
    assert.equal(globalFetchCalls, 0, "有 net 时一次都不许碰全局 fetch");
    // 逐跳白名单的前提没变：仍要手动跟随重定向，且每跳都带真的 AbortSignal。
    assert.equal(netCalls[0].init.redirect, "manual");
    assert.ok(netCalls[0].init.signal instanceof AbortSignal, "信号必须是 AbortSignal");
    assert.equal(loaded.events.errors.length, 0);
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("下载停滞：看门狗中止并抛 STALL，且清掉 0 字节的 .part 暂存文件", async () => {
  const loaded = loadUpdater({
    // 正文永不产出（连接假活）：headers 有 Content-Length，body 一个 chunk 都不来。
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "1048576" },
      body: new Readable({ read() {} }),
    }),
  });
  const dest = path.join(loaded.tmpRoot, INSTALLER_NAME);
  // 看门狗定时器是 unref 的（生产里事件循环由 Electron 与真实套接字撑着，见
  // downloadToFile 的注释）。这里的替身流没有任何 handle，事件循环会先一步清空、
  // 进程直接退出，50ms 的定时器永远等不到——用例必须自己 hold 住事件循环。
  const keepAlive = setTimeout(() => {}, 5_000);
  try {
    await assert.rejects(
      () => loaded.exports.downloadToFile(ASSET_URL, dest, { stallTimeoutMs: 50 }),
      (err) => {
        assert.equal(err.code, "STALL", `停滞必须有专属错误码（实际：${err && err.message}）`);
        assert.match(err.message, /stalled/, "错误信息要能自己说明是停滞");
        return true;
      },
    );
    // 失败路径必须收干净：留下 0 字节的 .part 正是用户在 %TEMP% 里看到的东西。
    assert.equal(fs.existsSync(`${dest}.part`), false, "停滞失败后不能留下暂存文件");
  } finally {
    clearTimeout(keepAlive);
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("连点两次「立即更新」：复用同一个 Promise，元数据只查一次，结束后锁复位", async () => {
  let metadataFetches = 0;
  const loaded = loadUpdater({
    fetchImpl: async () => {
      metadataFetches += 1;
      // 让第一次请求"在飞"，第二次调用才一定落在 in-flight 窗口里。
      await new Promise((resolve) => setImmediate(resolve));
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => UP_TO_DATE_RELEASE,
        body: null,
      };
    },
  });
  try {
    const deps = { manual: false };
    const p1 = loaded.exports.checkAndOfferUpdate(null, deps);
    const p2 = loaded.exports.checkAndOfferUpdate(null, deps);
    assert.strictEqual(p1, p2, "并发调用必须拿到同一个 Promise（否则会并发两个下载）");
    await p1;
    assert.equal(metadataFetches, 1, "第二次调用不该再发一次请求");
    // 锁不能永久卡住：上一次结束后，下一次点击必须真的重新走一遍流程。
    await loaded.exports.checkAndOfferUpdate(null, deps);
    assert.equal(metadataFetches, 2, "流程结束（成功或失败）后锁必须复位");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("元数据用 manual 逐跳校验，资产下载必须用 follow（electron#43715）", async () => {
  // electron#43715：net.fetch 在 redirect:"manual" 下遇到 302 直接抛
  // `Redirect was cancelled`（stale 关闭、无确认修复；QA 在 45.3.2 上实测复发），而
  // github.com 的资产地址必然 302 到 release-assets.githubusercontent.com——下载用
  // manual 就等于装不上。元数据那条仍在用 manual（逐跳校验 ALLOWED_HOSTS）。
  //
  // 两次请求都必须走 **net.fetch**（Chromium 网络栈才认系统代理）：下载那次若退回全局
  // fetch，代理环境下正文一个字节都收不到。所以这里 net 桩接管全部请求，全局 fetch 一旦
  // 被调用就失败。
  const redirectModes = [];
  let globalFetchCalls = 0;
  const netStub = {
    fetch: async (_input, init = {}) => {
      redirectModes.push(init.redirect);
      if (redirectModes.length === 1) {
        // 元数据：同版本，检查在"已是最新"处结束，不进下载。
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => UP_TO_DATE_RELEASE,
          body: null,
        };
      }
      // 下载：一个能一次读完的最小正文。
      return {
        ok: true,
        status: 200,
        headers: { get: () => "5" },
        body: Readable.from(["hello"]),
      };
    },
  };
  const loaded = loadUpdater({
    netStub,
    fetchImpl: async () => {
      globalFetchCalls += 1;
      assert.fail("有 net 时下载也不许回落全局 fetch（代理环境里它收不到正文）");
    },
  });
  const dest = path.join(loaded.tmpRoot, INSTALLER_NAME);
  try {
    await loaded.exports.checkAndOfferUpdate(null, {});
    const { size } = await loaded.exports.downloadToFile(ASSET_URL, dest);
    assert.equal(size, 5);
    assert.equal(globalFetchCalls, 0, "两次请求都必须走 net.fetch");
    assert.equal(redirectModes[0], "manual", "元数据仍要逐跳校验（ALLOWED_HOSTS）");
    assert.equal(
      redirectModes[1],
      "follow",
      "下载不能再用 manual：net.fetch 遇 302 会抛 Redirect was cancelled",
    );
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("拿响应头也计入停滞预算：代理接受连接但永不回响应头时按 STALL 收场", async () => {
  // QA 实测的 third 形态：连上了、但响应头永远不来（mode=no-headers 3 秒内没有任何中止
  // 迹象）。它只靠 60 分钟整程上限时等于不设防，所以拿头阶段必须按 stallTimeoutMs 计时。
  // 替身必须**响应 signal**（真实 fetch 会），否则这里等的是一个永不 settle 的 Promise。
  const loaded = loadUpdater({
    fetchImpl: (_input, init = {}) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
  });
  const dest = path.join(loaded.tmpRoot, INSTALLER_NAME);
  const keepAlive = setTimeout(() => {}, 5_000);
  // 拿头预算若没生效，这个 Promise 会一直 pending——事件循环里没有任何 handle，整份用例
  // 会以"pending 到进程退出"这种难读的形态失败。加一个 2 秒的护栏，把它变成一条能读的
  // 断言失败（反证时正是靠它精确变红）。
  let guardTimer = null;
  const guard = new Promise((_resolve, reject) => {
    guardTimer = setTimeout(
      () => reject(new Error("拿响应头阶段没有任何中止迹象：stallTimeoutMs 预算没有生效")),
      2_000,
    );
  });
  try {
    await assert.rejects(
      () =>
        Promise.race([
          loaded.exports.downloadToFile(ASSET_URL, dest, { stallTimeoutMs: 50 }),
          guard,
        ]),
      (err) => {
        assert.equal(err.code, "STALL", `拿头阶段超时也必须是 STALL（实际：${err && err.message}）`);
        assert.match(err.message, /response headers/, "错误信息要说清卡在哪一段");
        return true;
      },
    );
    assert.equal(fs.existsSync(`${dest}.part`), false, "拿头阶段失败也不许留下暂存文件");
  } finally {
    clearTimeout(guardTimer);
    clearTimeout(keepAlive);
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("手动检查遇到 STALL：弹「下载没有进展」，不是笼统的「检查更新失败」", async (t) => {
  // 自动安装链路只在 win32 上走（runManualUpdateCheck 的平台判定），别的平台上这条
  // 出口是"请手动下载"，断言不适用。
  if (process.platform !== "win32") {
    t.skip("installer protocol is Windows-only (see runManualUpdateCheck)");
    return;
  }
  // 这里只需要 code 为 STALL 的失败：真实停滞由"下载停滞"那条用例负责（它跑的是
  // downloadToFile，必须毫秒级超时，走不到 runManualUpdateCheck 的 catch）。
  // 两条用例合起来才是完整契约：真实停滞一定产出 STALL，STALL 一定给专属文案。
  const loaded = loadUpdater({
    fetchImpl: async () => {
      throw Object.assign(new Error("download stalled: no bytes for 45000 ms"), { code: "STALL" });
    },
  });
  const lines = [];
  try {
    loaded.exports.runManualUpdateCheck(null, (line) => lines.push(line));
    // catch 是异步的：等它把对话框弹出来。
    for (let i = 0; i < 50 && loaded.events.errors.length === 0; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(loaded.events.errors.length, 1, "停滞必须让用户看见一句话");
    assert.equal(loaded.events.errors[0].title, "下载没有进展", "停滞不能退化成通用失败提示");
    assert.match(loaded.events.errors[0].message, /45 秒/, "要说清是多久没有收到数据");
    assert.match(loaded.events.errors[0].message, /代理/, "要给「确认代理」这条出路");
    assert.ok(
      lines.some((line) => /manual update check failed: .*stalled/.test(line)),
      `日志里也要留痕（实际：${JSON.stringify(lines)}）`,
    );
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});
