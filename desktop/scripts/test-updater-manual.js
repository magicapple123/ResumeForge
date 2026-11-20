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
const vm = require("node:vm");
const { test } = require("node:test");

const REPO_DESKTOP = path.join(__dirname, "..");
const APP_VERSION = "0.18.0";
const LATEST = "0.19.0";
const INSTALLER_NAME = `ResumeForge-Setup-${LATEST}.exe`;

/**
 * updater.js 跑在 Node VM 里：electron 与 fetch 都是桩，一次真实网络请求都不会发生。
 */
function loadUpdater({ fetchImpl, appLocale = "zh-CN" } = {}) {
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
    require(spec) {
      if (spec === "electron") return { app: appStub, dialog: dialogStub, shell: shellStub };
      // 相对 require 按 desktop/ 解析（沙箱的 require 是这份 harness 自己的）。
      if (spec.startsWith(".")) return require(path.join(REPO_DESKTOP, spec));
      return require(spec);
    },
    module: { exports: {} },
    __filename: path.join(REPO_DESKTOP, "updater.js"),
    __dirname: REPO_DESKTOP,
  };

  const source = fs.readFileSync(path.join(REPO_DESKTOP, "updater.js"), "utf-8");
  vm.runInNewContext(source, sandbox, { filename: "desktop/updater.js" });
  return { exports: sandbox.module.exports, events, tmpRoot };
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
