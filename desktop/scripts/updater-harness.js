// SPDX-License-Identifier: Apache-2.0
"use strict";

// updater.js 用例**共用**的那一份 harness（2026-11-22 拆分时抽出）。
//
// 为什么要单独一个文件：`scripts/test-updater-manual.js` 一度是 496 行（desktop 预算
// 500，零豁免），拆成「发布资产不全 / 手动接线」与「代理 / 停滞 / 单飞锁」两个文件之后，
// VM 加载、electron 桩、fetch 桩、release 构造这些东西两边都要。复制第二份就会有两份
// 会各自漂移的桩——真正的真相只有一份：沙箱加载在本目录的 `updater-sandbox.js`（相对
// require 也在沙箱里求值的那套），本文件只负责"把沙箱摆好"。
//
// 全部离线：electron 与 fetch 都是替身，一次真实网络请求都不会发生。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// 本文件自己那个 loadUpdater 也叫 loadUpdater（构造沙箱），这里只要"在沙箱里求值"那一步。
const { REPO_DESKTOP, loadUpdater: runUpdaterModule } = require("./updater-sandbox");

const APP_VERSION = "0.18.0";
const LATEST = "0.19.0";
const INSTALLER_NAME = `ResumeForge-Setup-${LATEST}.exe`;
/** 同版本的 release：检查在"已是最新"这一支就结束，永远不会走到下载。 */
const UP_TO_DATE_RELEASE = { tag_name: `v${APP_VERSION}`, assets: [] };
const ASSET_URL = `https://github.com/magicapple123/ResumeForge/releases/download/v${LATEST}/${INSTALLER_NAME}`;

/**
 * 把 updater.js 放进沙箱跑起来，返回它的 exports、被记录的用户可见动作与临时目录。
 *
 * `netStub` 对应 Electron 的 `net`：不传时 `require("electron").net` 是 undefined，
 * updater 会回落全局 fetch（这条回落只服务离线用例，见 networkFetch 的注释）。
 *
 * 调用方**必须**在 finally 里 `fs.rmSync(loaded.tmpRoot, { recursive: true, force: true })`：
 * 每次加载都会建一个临时 userData 目录。
 *
 * @param {object} [options]
 * @param {function} [options.fetchImpl] 全局 fetch 的替身。
 * @param {object} [options.netStub] Electron `net` 的替身（含 `fetch`）。
 * @param {string} [options.appLocale] `app.getLocale()` 的返回值（i18n 分支用）。
 * @returns {{exports: object, events: {dialogs: object[], errors: object[], quit: string[]}, tmpRoot: string}}
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

/** 一次 ok 的 releases 响应（`json()` 只回这个 release）。 */
function respondWith(release) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => release,
    body: null,
  });
}

module.exports = {
  APP_VERSION,
  ASSET_URL,
  INSTALLER_NAME,
  LATEST,
  UP_TO_DATE_RELEASE,
  loadUpdater,
  releaseWith,
  respondWith,
};
