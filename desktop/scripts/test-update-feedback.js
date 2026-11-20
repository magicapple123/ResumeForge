// SPDX-License-Identifier: Apache-2.0
"use strict";

// 更新反馈（对话框 / 进度条 / 启动对账）的离线用例（2026-11-20，第 9.2 9.3 9.4 条）。
//
// lib/update-feedback.js 不 require("electron")——app / dialog / shell 全部注入，
// 所以这里可以直接构造假对象，不启动壳、不联网、不弹真窗口。
//
// 覆盖：
//   1. 第 9.3 条：三个对话框跟随壳层语言，**中英文都要出现"数据不会被覆盖"那句**；
//   2. 第 9.4 条：下载进度按比例写进任务栏，结束清除；total 未知时不乱报；
//      窗口已销毁 / 不支持 setProgressBar 时不得抛；
//   3. 第 9.2 条：启动对账在"没装成"时弹提示并提供手动下载 / 打开日志两个出口，
//      提示只用一次（弹完删标记）；版本已变则一句都不说；
//   4. 手动下载引导按平台说对话：macOS 说 .dmg，Linux 说单文件 AppImage，
//      **Linux 不能拿到 macOS 那句**（平台由 deps.platform 注入，覆盖两个分支）；
//      Linux 文案里的架构词只能出现发布页上真有的 x86_64 / arm64（不是 aarch64），
//      版本号只能是占位符（写死 2.2.0 这类示例发一版就过期）。
//
// Run with: node --test scripts/test-update-feedback.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  FALLBACK_MANUAL_BODY_KEY,
  MANUAL_BODY_KEYS,
  RELEASES_PAGE,
  createUpdateFeedback,
  manualBodyKey,
  resolvePlatform,
} = require("../lib/update-feedback");
const { recordUpdateAttempt, attemptFilePath } = require("../lib/update-attempt");
const { messages, t } = require("../lib/shell-locale");

/** 假 app / dialog / shell：记录调用，按 responses 依次回应。 */
function harness({
  version = "2.1.0",
  responses = [],
  locale = "en",
  logDir = "C:/logs",
  platform = "darwin",
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-update-feedback-"));
  const calls = { dialogs: [], errorBoxes: [], externals: [], opened: [], progress: [], log: [] };
  let index = 0;
  const app = {
    getVersion: () => version,
    getPath: (name) => (name === "userData" ? dir : logDir),
    getLocale: () => "en-US",
  };
  const dialog = {
    showMessageBox: (...args) => {
      calls.dialogs.push(args.length > 1 ? args[1] : args[0]);
      const response = responses[index] ?? 2;
      index += 1;
      return Promise.resolve({ response });
    },
    showErrorBox: (title, message) => calls.errorBoxes.push({ title, message }),
  };
  const shell = {
    openExternal: (url) => {
      calls.externals.push(url);
      return Promise.resolve();
    },
    openPath: (target) => {
      calls.opened.push(target);
      return Promise.resolve("");
    },
  };
  const feedback = createUpdateFeedback(
    { app, dialog, shell },
    {
      getLocale: () => locale,
      getLogDir: () => logDir,
      logLine: (line) => calls.log.push(line),
      // 平台注入：文案按平台分，不能靠"当前这台机器"来决定用例覆盖哪个分支。
      platform,
    },
  );
  return {
    calls,
    dir,
    feedback,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** 窗口桩：只实现被用到的方法，进度条调用都记下来。 */
function fakeWindow(overrides = {}) {
  const progress = [];
  return {
    progress,
    window: {
      isDestroyed: () => false,
      setProgressBar: (ratio) => progress.push(ratio),
      ...overrides,
    },
  };
}

// ---- 第 9.3 条：文案语言 + 数据安全说明 ------------------------------------

test("9.3 发现新版本对话框：中英文都含数据安全说明，语言跟 getLocale()", async () => {
  for (const locale of ["zh", "en"]) {
    const { calls, feedback, cleanup } = harness({ locale });
    try {
      await feedback.confirm(null, "2.2.0");
      const options = calls.dialogs[0];
      assert.match(options.message, /2\.2\.0/, "标题要带新版本号");
      assert.equal(options.message, t(locale, "update.available.message", { version: "2.2.0" }));
      assert.equal(options.detail, t(locale, "update.available.body"));
      // 数据安全：用户 2026-11-20 明确要求"告知数据不会被覆盖"。
      if (locale === "zh") {
        assert.match(options.detail, /不会覆盖或删除/);
        assert.match(options.detail, /自动重新打开/, "9.1 之后这句承诺才为真（--force-run）");
      } else {
        assert.match(options.detail, /not be overwritten or deleted/);
        assert.match(options.detail, /reopen automatically/);
        assert.equal(/[\u4e00-\u9fa5]/.test(options.detail), false, "英文界面不得出现中文");
      }
      // 两个按钮也要翻译（否则英文界面出现「立即更新 / 暂不」）。
      assert.deepEqual(options.buttons, [
        t(locale, "update.button.install"),
        t(locale, "update.button.later"),
      ]);
      assert.equal(options.defaultId, 0, "回车应当是「立即更新」，不是「暂不」");
    } finally {
      cleanup();
    }
  }
});

test("9.3 三个对话框 + 手动下载引导 + 错误框都走文案表（没有硬编码中文）", () => {
  const zh = messages.zh;
  for (const key of [
    "update.available.message",
    "update.available.body",
    "update.incomplete.message",
    "update.incomplete.body",
    "update.upToDate.message",
    "update.upToDate.body",
    "update.failed.message",
    "update.failed.body",
    "update.failed.bodyNoLog",
    "update.manual.message",
    "update.manual.body",
    "update.manual.bodyLinux",
    "update.error.title",
    "update.error.body",
    "update.button.install",
    "update.button.later",
    "update.button.ok",
    "update.button.openReleases",
    "update.button.close",
    "update.failed.button.download",
    "update.failed.button.openLogDir",
    "update.failed.button.ack",
  ]) {
    assert.equal(typeof zh[key], "string", `文案表缺 ${key}`);
    assert.equal(typeof messages.en[key], "string", `英文文案表缺 ${key}`);
  }
  // 平台 → key 的映射与回退 key 必须都真的存在于两张表里（拼错 key 时 t() 会原样返回
  // key，用户看到的是 "update.manual.bodyLinux" 这种字样）。
  for (const key of [...Object.values(MANUAL_BODY_KEYS), FALLBACK_MANUAL_BODY_KEY]) {
    assert.equal(typeof zh[key], "string", `文案表缺 ${key}`);
    assert.equal(typeof messages.en[key], "string", `英文文案表缺 ${key}`);
  }
  // 英文侧不能混进中文（这条正是 9.3 的根因：英文用户看到中文）。
  for (const [key, value] of Object.entries(messages.en)) {
    if (!key.startsWith("update.")) continue;
    assert.equal(/[\u4e00-\u9fa5]/.test(value), false, `en.${key} 混进了中文：${value}`);
  }
});

test("9.3 附件缺失 / 已是最新 / 平台引导：文案与按钮都跟语言走", async () => {
  const zh = harness({ locale: "zh" });
  await zh.feedback.incomplete(null, "2.2.0", "ResumeForge-Setup-2.2.0.exe");
  await zh.feedback.upToDate(null, "2.1.0");
  const zhIncomplete = zh.calls.dialogs[0];
  const zhUpToDate = zh.calls.dialogs[1];
  assert.match(zhIncomplete.detail, /缺少 ResumeForge-Setup-2\.2\.0\.exe/);
  assert.match(zhUpToDate.detail, /2\.1\.0/);
  zh.cleanup();

  const en = harness({ locale: "en" });
  await en.feedback.incomplete(null, "2.2.0", "Setup.exe.sha256");
  assert.equal(en.calls.dialogs[0].message, "This release's installer is not fully uploaded");
  en.feedback.errorBox("fetch failed");
  assert.equal(en.calls.errorBoxes[0].title, "Update check failed");
  assert.match(en.calls.errorBoxes[0].message, /fetch failed/, "原因必须原样带上");
  en.cleanup();

  // macOS：不假装能静默升级，如实引导到发布页。
  const mac = harness({ locale: "en", platform: "darwin", responses: [0] });
  await mac.feedback.manualPlatform();
  assert.equal(mac.calls.externals[0], RELEASES_PAGE);
  mac.cleanup();
});

// ---- 手动下载引导：按平台说对话（本 bug：Linux 拿到了 macOS 那句）----------

test("手动下载引导按平台分文案：darwin 说 .dmg，linux 说 AppImage，互不串味", async () => {
  for (const locale of ["zh", "en"]) {
    // macOS：保持原来的那句（.dmg + 拖进「应用程序」/ drag into Applications）。
    const mac = harness({ locale, platform: "darwin", responses: [0] });
    try {
      await mac.feedback.manualPlatform();
      const options = mac.calls.dialogs[0];
      assert.equal(options.detail, t(locale, "update.manual.body"), "macOS 仍用原来那条 body");
      assert.match(options.detail, /\.dmg/);
      assert.equal(options.defaultId, 0, "回车应当是「打开发布页」");
      assert.equal(mac.calls.externals[0], RELEASES_PAGE, "「打开发布页」要真的打开");
    } finally {
      mac.cleanup();
    }

    // Linux：单文件 AppImage、替换原文件；.dmg 与「应用程序」一个字都不能出现。
    const linux = harness({ locale, platform: "linux" });
    try {
      await linux.feedback.manualPlatform();
      const detail = linux.calls.dialogs[0].detail;
      // 先断"不含 .dmg"：本 bug 的形态就是 Linux 拿到了 macOS 的句子。
      assert.equal(/\.dmg/i.test(detail), false, `Linux 用户不该看到 .dmg：${detail}`);
      assert.equal(detail.includes("应用程序"), false, `Linux 没有「应用程序」：${detail}`);
      assert.equal(detail.includes("Applications"), false, `Linux has no "Applications"：${detail}`);
      assert.match(detail, /AppImage/, "要点是「下载新的 AppImage」");
      assert.match(detail, locale === "zh" ? /替换你现在启动的那个/ : /replace the file you are running/);
      assert.match(detail, locale === "zh" ? /不需要安装/ : /nothing to install/, "要说明它是单文件、无需安装");
      // 架构词必须是发布页上真有的：AppImage 产物只有 x86_64 与 arm64
      // （electron-builder 只对 pacman/rpm/flatpak 把 arm64 改写成 aarch64）。
      // 写成 aarch64 等于让用户去发布页找一个不存在的文件名。
      assert.equal(detail.includes("aarch64"), false, `发布页没有 aarch64 产物：${detail}`);
      const archWords = detail.match(/\b(?:x86_64|aarch64|arm64|amd64|x64|armv7l|armhf)\b/g) || [];
      assert.ok(archWords.length > 0, `要按架构指路：${detail}`);
      for (const word of archWords) {
        assert.ok(["x86_64", "arm64"].includes(word), `架构词只允许 x86_64 / arm64，出现 ${word}`);
      }
      assert.ok(archWords.includes("x86_64") && archWords.includes("arm64"), "两个架构都要提到");
      // 版本号必须是占位符：文案常驻，写死某个版本一发新版就过期（2.2.0 那次就是）。
      assert.equal(
        detail.includes(locale === "zh" ? "<版本>" : "<version>"),
        true,
        `版本号要写成占位符：${detail}`,
      );
      assert.equal(/ResumeForge-\d+\.\d+\.\d+/.test(detail), false, `不要写死版本号：${detail}`);
      assert.equal(detail, t(locale, "update.manual.bodyLinux"), "Linux 必须用 update.manual.bodyLinux");
      assert.notEqual(detail, t(locale, "update.manual.body"), "Linux 不得回落到 macOS 文案");
    } finally {
      linux.cleanup();
    }
  }
});

test("手动下载引导：平台可注入且没有回落到 macOS 文案；旧名字 manualMac 已不存在", async () => {
  // 表里没有的平台（也没有发行包）同样不能悄悄拿到 macOS 那句。
  const other = harness({ locale: "en", platform: "freebsd" });
  try {
    await other.feedback.manualPlatform();
    const detail = other.calls.dialogs[0].detail;
    assert.equal(/\.dmg/i.test(detail), false, `未知平台也不该拿到 .dmg 那句：${detail}`);
    assert.equal(detail, t("en", FALLBACK_MANUAL_BODY_KEY));
    assert.equal(typeof other.feedback.manualMac, "undefined", "manualMac 这个名字必须彻底消失");
    assert.equal(typeof other.feedback.manualPlatform, "function");
  } finally {
    other.cleanup();
  }

  // 平台映射本身：darwin / linux 各一条，回退 key 不能等于 darwin 的 key。
  assert.equal(manualBodyKey("darwin"), "update.manual.body");
  assert.equal(manualBodyKey("linux"), "update.manual.bodyLinux");
  assert.notEqual(manualBodyKey("win32"), MANUAL_BODY_KEYS.darwin, "回退不能是 macOS 文案");
});

test("手动下载引导：平台注入是确定性的，空串不退回宿主平台（宿主无关）", async () => {
  // null / undefined = 没注入 -> process.platform。
  assert.equal(resolvePlatform(undefined), process.platform);
  assert.equal(resolvePlatform({}), process.platform);
  assert.equal(resolvePlatform({ platform: null }), process.platform);
  assert.equal(resolvePlatform({ platform: undefined }), process.platform);
  // 注入了就用注入值。空串**原样采用**：写成 `injected || process.platform` 时，手滑写
  // `platform: ""` 的用例会静默退化成宿主平台——win32 上偶然变绿、darwin 上变红。
  assert.equal(resolvePlatform({ platform: "linux" }), "linux");
  assert.equal(resolvePlatform({ platform: "" }), "");
  assert.notEqual(resolvePlatform({ platform: "" }), process.platform);
  assert.equal(manualBodyKey(resolvePlatform({ platform: "" })), FALLBACK_MANUAL_BODY_KEY);

  // 走完整条链路：空串平台弹的是回退文案（不是 macOS 那句，也不看宿主）。
  const empty = harness({ locale: "en", platform: "" });
  try {
    await empty.feedback.manualPlatform();
    assert.equal(empty.calls.dialogs[0].detail, t("en", FALLBACK_MANUAL_BODY_KEY));
    assert.notEqual(empty.calls.dialogs[0].detail, t("en", "update.manual.body"));
  } finally {
    empty.cleanup();
  }
});

// ---- 第 9.4 条：任务栏进度 ------------------------------------------------

test("9.4 下载进度写进任务栏：按比例、单调、结束清除", () => {
  const { feedback } = harness();
  const { window: win, progress } = fakeWindow();
  feedback.progress(win, 42 * 1024 * 1024, 188 * 1024 * 1024);
  feedback.progress(win, 188 * 1024 * 1024, 188 * 1024 * 1024);
  feedback.clearProgress(win);
  assert.equal(progress.length, 3);
  assert.ok(Math.abs(progress[0] - 0.223) < 0.01, `第一个比例应约 0.22，实际 ${progress[0]}`);
  assert.equal(progress[1], 1, "下载结束必须是 100%");
  assert.equal(progress[2], -1, "结束/失败一律 setProgressBar(-1) 清除");
  assert.ok(progress.every((value) => value <= 1), "比例不得超过 1（服务端少报长度时也不能超）");
});

test("9.4 total 未知时不报进度（宁可没有，也不拿 0% 骗人）", () => {
  const { feedback } = harness();
  const { window: win, progress } = fakeWindow();
  feedback.progress(win, 1024, 0);
  feedback.progress(win, 1024, undefined);
  assert.deepEqual(progress, []);
});

test("9.4 窗口已销毁 / 没有 setProgressBar / 调用抛错：一律不得打断下载", () => {
  const { feedback } = harness();
  // 1) 已销毁
  const destroyed = { isDestroyed: () => true, setProgressBar: () => assert.fail("destroyed window must not be touched") };
  assert.doesNotThrow(() => feedback.progress(destroyed, 1, 2));
  // 2) 平台不提供这个方法
  assert.doesNotThrow(() => feedback.progress({ isDestroyed: () => false }, 1, 2));
  assert.doesNotThrow(() => feedback.clearProgress({}));
  // 3) 调用本身抛
  assert.doesNotThrow(() =>
    feedback.progress({ isDestroyed: () => false, setProgressBar: () => { throw new Error("boom"); } }, 1, 2),
  );
  // 4) null 父窗口（托盘场景）
  assert.doesNotThrow(() => feedback.progress(null, 1, 2));
});

// ---- 第 9.2 条：启动对账 --------------------------------------------------

test("9.2 对账：没装成 -> 提示 + 手动下载；弹完删标记（不重复骚扰）", async () => {
  const { dir, calls, feedback, cleanup } = harness({ version: "2.1.0", responses: [0] });
  try {
    recordUpdateAttempt(dir, { from: "2.1.0", to: "2.2.0", installer: "C:/tmp/setup.exe" });
    const result = await feedback.reconcile(null);
    assert.equal(result.status, "failed");
    assert.equal(calls.dialogs.length, 1);
    const options = calls.dialogs[0];
    assert.equal(options.type, "warning");
    assert.equal(options.message, t("en", "update.failed.message"));
    assert.match(options.detail, /2\.1\.0 → 2\.2\.0|2\.1\.0 → 2\.2\.0/);
    assert.match(options.detail, /were not affected/, "也要说明数据没受影响");
    assert.match(options.detail, /C:\/logs/, "带上日志目录");
    assert.deepEqual(options.buttons, ["Download manually", "Open log", "Got it"]);
    assert.equal(options.cancelId, 2, "Esc/关闭等于「知道了」，不是「手动下载」");
    assert.equal(calls.externals[0], RELEASES_PAGE, "「手动下载」打开发布页");
    assert.equal(fs.existsSync(attemptFilePath(dir)), false, "提示只用一次：弹完就删标记");
    assert.ok(calls.log.some((line) => line.includes("did not install")), "日志里要留痕");
    // 第二次启动不再提示。
    assert.equal((await feedback.reconcile(null)).status, "none");
    assert.equal(calls.dialogs.length, 1);
  } finally {
    cleanup();
  }
});

test("9.2 对账：「打开日志」走 openPath；拿不到日志目录时退化成无路径文案", async () => {
  const opened = harness({ version: "2.1.0", responses: [1], logDir: "D:/rf-logs" });
  try {
    recordUpdateAttempt(opened.dir, { from: "2.1.0", to: "2.2.0" });
    await opened.feedback.reconcile(null);
    assert.deepEqual(opened.calls.opened, ["D:/rf-logs"]);
  } finally {
    opened.cleanup();
  }

  const noLog = harness({ version: "2.1.0", responses: [2], logDir: null });
  try {
    recordUpdateAttempt(noLog.dir, { from: "2.1.0", to: "2.2.0" });
    await noLog.feedback.reconcile(null);
    assert.match(noLog.calls.dialogs[0].detail, /were not affected/);
    assert.equal(/Update log:/.test(noLog.calls.dialogs[0].detail), false, "没有日志目录就别写这一行");
  } finally {
    noLog.cleanup();
  }
});

test("9.2 对账：版本已变 / 没有标记 -> 一句都不说，静默", async () => {
  const upgraded = harness({ version: "2.2.0" });
  try {
    recordUpdateAttempt(upgraded.dir, { from: "2.1.0", to: "2.2.0" });
    assert.equal((await upgraded.feedback.reconcile(null)).status, "installed");
    assert.equal(upgraded.calls.dialogs.length, 0, "正常升级完不能有任何提示");
    assert.equal(fs.existsSync(attemptFilePath(upgraded.dir)), false);
  } finally {
    upgraded.cleanup();
  }

  const fresh = harness({ version: "2.1.0" });
  try {
    assert.equal((await fresh.feedback.reconcile(null)).status, "none");
    assert.equal(fresh.calls.dialogs.length, 0);
  } finally {
    fresh.cleanup();
  }
});

test("9.2 对账：对话框抛错也不能把启动流程带走（标记照样清理）", async () => {
  const { dir, feedback, cleanup } = harness({ version: "2.1.0" });
  const brokenDialog = {
    showMessageBox: () => Promise.reject(new Error("dialog blocked")),
    showErrorBox: () => {},
  };
  const app = { getVersion: () => "2.1.0", getPath: () => dir, getLocale: () => "en" };
  try {
    recordUpdateAttempt(dir, { from: "2.1.0", to: "2.2.0" });
    const resilient = createUpdateFeedback(
      { app, dialog: brokenDialog, shell: {} },
      { getLocale: () => "en", logLine: () => {} },
    );
    const result = await resilient.reconcile(null);
    assert.equal(result.status, "failed");
    assert.equal(fs.existsSync(attemptFilePath(dir)), false, "失败也要清标记，否则每次启动都卡在这里");
    // 原 feedback 只是为了拿到同一个临时目录，不参与断言。
    assert.equal(typeof feedback.reconcile, "function");
  } finally {
    cleanup();
  }
});
