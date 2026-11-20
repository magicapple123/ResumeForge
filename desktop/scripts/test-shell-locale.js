// SPDX-License-Identifier: Apache-2.0
/**
 * 壳层文案双语的离线用例（T5 批 2，A 任务）：
 *
 *  - lib/shell-locale.js：语言裁决规则（必须与前端 detectPreferredLocale 同规则）、
 *    环境变量兜底、zh/en 文案表齐全且占位符一致、t() 的替换与缺 key 约定；
 *  - lib/shell-locale-runtime.js：应用内语言切换后的重建（托盘刷新 + 标题兜底、去重）；
 *  - lib/tray-menu.js / lib/desktop-menu.js / lib/preflight.js / lib/startup-failure.js：
 *    两套语言下各拿到什么文案（mock electron API，不启动真壳）；
 *  - lib/close-dialog.js + close-dialog.html：关闭卡片按 ?locale= 选表、缺省英文。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const {
  DEFAULT_SHELL_LOCALE,
  SHELL_LOCALES,
  messages,
  normalizeShellLocale,
  resolveShellLocale,
  resolveShellLocaleFromEnvironment,
  t,
} = require("../lib/shell-locale");
const { createShellLocaleRuntime } = require("../lib/shell-locale-runtime");
const { buildMenuModel, createTrayManager, trayLabelsFor } = require("../lib/tray-menu");
const { createDesktopMenuActions } = require("../lib/desktop-menu");
const { preflightNoticeText, presentPreflightNotice } = require("../lib/preflight");
const { createStartupFailureReporter } = require("../lib/startup-failure");
const { createClosePrompt } = require("../lib/close-dialog");

const DESKTOP_DIR = path.join(__dirname, "..");

/** 文案里出现的 {name} 占位符（排序后比较，两侧必须一致）。 */
function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

// ---- resolveShellLocale：与前端 detectPreferredLocale 同一规则 -----------------

/**
 * 同一组 tag 在两侧必须给出同一个"是不是中文"的结论。
 * 前端那一半在 frontend/src/i18n/shellLocaleBridge.test.tsx（它直接执行本模块文件），
 * 这里钉住桌面侧的具体取值：zh-TW / en-US / C 三组是两边共同覆盖的最小集合。
 */
test("resolveShellLocale：zh / zh-* -> zh，其余（含 C locale、空串）-> en", () => {
  const cases = [
    ["zh", "zh"],
    ["zh-CN", "zh"],
    ["zh-TW", "zh"],
    ["zh-Hant", "zh"],
    // 下划线写法不是语言标签（环境变量才用），直接裁决与 detectPreferredLocale 一样是英文；
    // 环境变量路径在 resolveShellLocaleFromEnvironment 里先归一化（见下一个用例）。
    ["zh_CN", "en"],
    ["en", "en"],
    ["en-US", "en"],
    ["C", "en"],
    ["C.UTF-8", "en"],
    ["ja-JP", "en"],
    ["", "en"],
    [undefined, "en"],
    [null, "en"],
    [42, "en"],
  ];
  for (const [tag, expected] of cases) {
    assert.equal(resolveShellLocale(tag), expected, `tag=${String(tag)}`);
  }
  assert.deepEqual(SHELL_LOCALES, ["zh", "en"]);
  assert.equal(DEFAULT_SHELL_LOCALE, "en", "缺省英文（非中文环境不得先闪中文）");
});

test("resolveShellLocaleFromEnvironment：空串 + LANG=zh_CN / LANG=C / app 优先 / 全空 -> en", () => {
  // Linux 上 app.getLocale() 可能返回空串：回落到 LC_ALL / LANG。
  assert.equal(resolveShellLocaleFromEnvironment("", { LANG: "zh_CN" }), "zh");
  assert.equal(resolveShellLocaleFromEnvironment("", { LANG: "zh_CN.UTF-8" }), "zh");
  assert.equal(resolveShellLocaleFromEnvironment("", { LANG: "C" }), "en");
  assert.equal(resolveShellLocaleFromEnvironment("", { LANG: "en_US.UTF-8" }), "en");
  // app.getLocale() 有值时优先于环境变量。
  assert.equal(resolveShellLocaleFromEnvironment("en-US", { LANG: "zh_CN" }), "en");
  assert.equal(resolveShellLocaleFromEnvironment("zh-CN", { LANG: "C" }), "zh");
  // LC_ALL 优先于 LANG。
  assert.equal(resolveShellLocaleFromEnvironment("", { LC_ALL: "zh_TW", LANG: "en_US" }), "zh");
  // 全空（含 Windows 上常见的"两个都没设"）-> 英文。
  assert.equal(resolveShellLocaleFromEnvironment("", {}), "en");
  assert.equal(resolveShellLocaleFromEnvironment("", undefined), "en");
});

test("normalizeShellLocale：只接受 zh / en，其它一律 null（IPC 入参校验用）", () => {
  assert.equal(normalizeShellLocale("zh"), "zh");
  assert.equal(normalizeShellLocale("en"), "en");
  assert.equal(normalizeShellLocale("fr"), null);
  assert.equal(normalizeShellLocale(""), null);
  assert.equal(normalizeShellLocale(undefined), null);
  assert.equal(normalizeShellLocale({ locale: "zh" }), null);
});

// ---- 文案表守卫：防漏 key / 防漏占位符 -----------------------------------------

test("messages：zh / en 两侧键集合完全一致且每条都非空（漏翻一个 key 就红）", () => {
  const zhKeys = Object.keys(messages.zh).sort();
  const enKeys = Object.keys(messages.en).sort();
  assert.deepEqual(zhKeys, enKeys, "zh 与 en 的键必须一一对应");
  assert.ok(zhKeys.length >= 40, `文案表至少覆盖 40 条用途键，当前 ${zhKeys.length}`);
  for (const key of zhKeys) {
    assert.equal(typeof messages.zh[key], "string", `zh.${key} 必须是字符串`);
    assert.equal(typeof messages.en[key], "string", `en.${key} 必须是字符串`);
    assert.ok(messages.zh[key].trim().length > 0, `zh.${key} 不能为空`);
    assert.ok(messages.en[key].trim().length > 0, `en.${key} 不能为空`);
  }
});

test("messages：两侧同名占位符一致（缺 {name} 会让英文句子里漏路径/原因）", () => {
  for (const key of Object.keys(messages.zh)) {
    assert.deepEqual(placeholders(messages.zh[key]), placeholders(messages.en[key]), key);
  }
});

test("t：替换 {name}、缺 key 返回 key 本身、未知语言回落英文", () => {
  assert.equal(t("zh", "tray.quit"), "退出");
  assert.equal(t("en", "tray.quit"), "Quit");
  assert.equal(
    t("zh", "migration.confirm.locations", { from: "旧", to: "新" }),
    "\n\n旧位置：旧\n新位置：新",
  );
  assert.equal(
    t("en", "startupFailure.detailNoLog", { message: "boom" }),
    "boom\n\nThis run could not write diagnostic logs (both the installation folder and the system temp folder are read-only).",
  );
  // 缺 key 与未知语言都不抛：界面出现 key 本身比空白更容易被发现。
  assert.equal(t("zh", "not.a.key"), "not.a.key");
  assert.equal(t("de-DE", "tray.quit"), "Quit");
});

// ---- 托盘 / 菜单 / 对话框：两套语言下各拿到什么 --------------------------------

function trayModel(locale, ask = true) {
  return buildMenuModel({
    getAsk: () => ask,
    runMenuAction: () => {},
    getLocale: () => locale,
  });
}

test("托盘菜单：语言由 getLocale 决定，模型与 tooltip 都来自壳层文案表", () => {
  for (const locale of ["zh", "en"]) {
    const labels = trayLabelsFor(locale);
    const model = trayModel(locale);
    const labelsInModel = model.filter((item) => item.type === "item").map((item) => item.label);
    assert.deepEqual(
      labelsInModel,
      [
        labels.open,
        labels.openDataDir,
        labels.openLogDir,
        labels.diagnostics,
        labels.checkUpdate,
        labels.askOnClose,
        labels.quit,
      ],
      locale,
    );
    // 工具提示与菜单来自同一张表：不应出现"菜单英文、tooltip 中文"。
    assert.equal(labels.tooltip, t(locale, "tray.tooltip"));
  }
  assert.notEqual(trayLabelsFor("zh").open, trayLabelsFor("en").open);
});

test("托盘生命周期：refresh 同步 tooltip；菜单模型在打开时按当前语言现算", () => {
  const trayCalls = [];
  class TrayFake {
    constructor() {
      this.handlers = {};
    }
    setToolTip(tooltip) {
      trayCalls.push(["tooltip", tooltip]);
    }
    on(name) {
      this.handlers[name] = true;
    }
    destroy() {}
  }
  let locale = "zh";
  const manager = createTrayManager({
    Tray: TrayFake,
    iconPath: "tray.ico",
    app: { quit() {} },
    getWindow: () => null,
    getAsk: () => true,
    setAsk: () => {},
    runMenuAction: () => {},
    getLocale: () => locale,
  });
  manager.create();
  const zhTooltip = trayCalls.find((entry) => entry[0] === "tooltip")[1];
  locale = "en";
  manager.refresh();
  const tooltips = trayCalls.filter((entry) => entry[0] === "tooltip").map((entry) => entry[1]);
  assert.equal(zhTooltip, "简历通");
  assert.equal(tooltips[tooltips.length - 1], "ResumeForge");
  // 自绘菜单不再有"重建"这一步：模型每次打开现算，所以语言切完立刻是英文。
  const labels = manager.getMenuModel().map((item) => item.label);
  assert.ok(labels.includes(t("en", "tray.quit")), "打开时的菜单必须是英文");
  assert.ok(!labels.includes(t("zh", "tray.quit")), "不得残留旧语言菜单项");
});

test("标题栏菜单回执：中文/英文两套错误文案都来自壳层表", async () => {
  for (const locale of ["zh", "en"]) {
    const menu = createDesktopMenuActions({
      app: { getVersion: () => "2.1.0" },
      getWindow: () => null,
      shell: { openPath: () => Promise.resolve(""), openExternal: () => Promise.resolve() },
      getDataDir: () => "D:/data",
      getLogDir: () => "D:/logs",
      runUpdateCheck: () => {},
      getLocale: () => locale,
    });
    const reload = await menu.run("view.reload");
    assert.equal(reload.ok, false);
    assert.equal(reload.error, t(locale, "menu.error.noPage"));
    const unknown = await menu.run("window.destroyEverything");
    assert.equal(unknown.error, t(locale, "menu.error.unknownAction", { action: "window.destroyEverything" }));
  }
});

test("preflight 降级提示：中英文各一套，路径与原因原样保留", async () => {
  const info = { logDir: "D:/logs", reason: "read-only install dir" };
  const zh = preflightNoticeText(info, "zh");
  const en = preflightNoticeText(info, "en");
  assert.equal(zh.message, "诊断日志的位置有变化");
  assert.equal(en.message, "Diagnostic log location changed");
  assert.match(zh.detail, /D:\/logs/);
  assert.match(en.detail, /read-only install dir/);
  assert.doesNotMatch(`${zh.detail}${en.detail}`, /EPERM|ENOENT/);

  // 对话框按钮也随语言走（第二条按钮才打开目录）。
  const opened = [];
  const boxes = [];
  await presentPreflightNotice({
    dialog: {
      showMessageBox: async (options) => {
        boxes.push(options);
        return { response: 1 };
      },
    },
    shell: { openPath: async (target) => opened.push(target) },
    info: { ...info, degraded: true },
    getLocale: () => "en",
  });
  assert.deepEqual([...boxes[0].buttons], ["Got it", "Open log folder"]);
  assert.equal(boxes[0].title, "ResumeForge");
  assert.deepEqual(opened, ["D:/logs"]);
});

function startupFailureDialog(locale, logDir = "D:/logs") {
  let box = null;
  const reporter = createStartupFailureReporter({
    dialog: {
      showMessageBoxSync: (options) => {
        box = options;
        return 1;
      },
    },
    shell: null,
    logLine: () => {},
    sendStage: () => {},
    getLogDir: () => logDir,
    setQuitting: () => {},
    app: { quit() {} },
    getLocale: () => locale,
  });
  reporter(new Error("Backend exited early (code=1)"));
  return box;
}

test("启动失败对话框：中英文两套标题/正文/按钮，错误原因原样透出", () => {
  const zh = startupFailureDialog("zh");
  const en = startupFailureDialog("en");
  assert.equal(zh.title, "简历通");
  assert.equal(zh.message, "启动失败");
  assert.deepEqual([...zh.buttons], ["打开日志目录", "退出"]);
  assert.match(zh.detail, /Backend exited early/);
  assert.match(zh.detail, /desktop-main\.log/);

  assert.equal(en.title, "ResumeForge");
  assert.equal(en.message, "Startup failed");
  assert.deepEqual([...en.buttons], ["Open log folder", "Quit"]);
  assert.match(en.detail, /desktop-main\.log/);

  // 没有日志目录时也要说清后果，而不是留一段空路径。
  const noLog = startupFailureDialog("en", null);
  assert.match(noLog.detail, /could not write diagnostic logs/);
});

// ---- 壳层语言运行时：切换后的重建 ---------------------------------------------

test("壳层语言运行时：系统语言兜底、切换后重建托盘与窗口标题、重复推送不重建", () => {
  const calls = [];
  const win = { isDestroyed: () => false, setTitle: (title) => calls.push(["title", title]) };
  const trayManager = { refresh: () => calls.push(["refresh"]) };
  const runtime = createShellLocaleRuntime({
    getWindow: () => win,
    getTrayManager: () => trayManager,
    logLine: () => {},
  });
  assert.equal(runtime.getLocale(), "en", "初始化前按英文兜底");
  assert.equal(runtime.initializeFromApp({ getLocale: () => "zh-TW" }), "zh");
  assert.equal(runtime.getLocale(), "zh");

  assert.equal(runtime.apply("en"), true);
  assert.deepEqual(calls, [["refresh"], ["title", "ResumeForge"]]);
  // 首帧与服务端校正可能各推一次：同语言不重复重建（否则托盘会闪）。
  assert.equal(runtime.apply("en"), false);
  // 非法值静默忽略，也不改变状态。
  assert.equal(runtime.apply("fr"), false);
  assert.equal(runtime.getLocale(), "en");
});

test("壳层语言运行时：没有窗口 / 窗口已销毁 / Tray 重建抛错时不连累退出路径", () => {
  const runtime = createShellLocaleRuntime({
    getWindow: () => ({ isDestroyed: () => true, setTitle: () => assert.fail("destroyed window") }),
    getTrayManager: () => ({ refresh: () => { throw new Error("tray gone"); } }),
    logLine: () => {},
  });
  runtime.initializeFromApp({ getLocale: () => "zh-CN" });
  // refresh 抛错不吞掉"语言已切换"这个事实，但也不能让主进程崩。
  assert.throws(() => runtime.apply("en"));
});

// ---- 关闭卡片：独立窗口按 ?locale= 选表，缺省英文 ------------------------------

function closePromptHarness(locale) {
  const calls = { urls: [] };
  function FakeBrowserWindow(options) {
    this.options = options;
    this.webContents = { send() {} };
  }
  FakeBrowserWindow.prototype.loadURL = function loadURL(url) {
    calls.urls.push(url);
    return Promise.resolve();
  };
  ["show", "focus", "destroy", "removeListener"].forEach((name) => {
    FakeBrowserWindow.prototype[name] = function noop() {};
  });
  FakeBrowserWindow.prototype.once = function once() {};
  FakeBrowserWindow.prototype.isDestroyed = function isDestroyed() {
    return false;
  };
  const parent = { isDestroyed: () => false, once() {} };
  const prompt = createClosePrompt({
    BrowserWindow: FakeBrowserWindow,
    ipcMain: { handle() {}, on() {} },
    getWindow: () => parent,
    dirname: DESKTOP_DIR,
    // locale 为 undefined 时**不传**这个依赖，验证 close-dialog.js 自己的英文缺省。
    ...(locale === undefined ? {} : { getShellLocale: () => locale }),
    logLine: () => {},
  });
  return { prompt, calls };
}

test("关闭卡片：loadURL 带当前壳层语言（?locale=zh|en，缺省英文）", async () => {
  for (const [locale, expected] of [["zh", "?locale=zh"], ["en", "?locale=en"], [undefined, "?locale=en"]]) {
    const { prompt, calls } = closePromptHarness(locale);
    // promptClose 的 Promise 要等用户在卡片上点按钮才 resolve（这里没有用户）：
    // 只等 loadURL 的微任务跑完，断言 URL 后让它 pending 着即可。
    void prompt({ isDestroyed: () => false }, { isMac: false }).catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.urls.length, 1);
    const url = calls.urls[0];
    assert.ok(url.startsWith("file:"), url);
    assert.ok(url.includes("close-dialog.html"), url);
    assert.ok(url.endsWith(expected), `${locale}: ${url}`);
  }
});

/** 在 vm 里跑 close-dialog.html 的内联脚本（假 DOM），返回观测面。 */
function runCloseDialogPage(search, isMac = false) {
  const source = fs.readFileSync(path.join(DESKTOP_DIR, "close-dialog.html"), "utf8");
  // 兼容 `<script>` / `<script type="...">` 与 `</script >`：只匹配无 src 的内联脚本块本身。
  // 写成宽匹配是为了避开 CodeQL 的 js/bad-tag-filter（旧正则固定标签名，遇到属性或
  // 大小写变化会漏匹配）。
  const match = source.match(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script\s*>/i);
  assert.ok(match, "close-dialog.html 必须保留内联文案脚本");
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        textContent: "",
        hidden: false,
        checked: false,
        listeners: {},
        addEventListener(name, handler) {
          this.listeners[name] = handler;
        },
        focus() {},
      });
    }
    return elements.get(id);
  };
  const documentStub = {
    documentElement: { lang: "" },
    title: "",
    getElementById: element,
    querySelector(selector) {
      return element(`selector:${selector}`);
    },
  };
  const windowStub = {
    location: { search },
    closeDialog: { platform: () => Promise.resolve(isMac), resolve() {} },
    addEventListener() {},
  };
  const sandbox = {
    document: documentStub,
    window: windowStub,
    URLSearchParams,
  };
  vm.runInNewContext(match[1], sandbox, { filename: "close-dialog.html#script" });
  return { sandbox, document: documentStub, element, settled: Promise.resolve().then(() => undefined) };
}

test("关闭卡片页面：?locale=zh / en / 缺省 / 未知值 各选哪套文案", async () => {
  const cases = [
    ["?locale=zh", "zh-CN", "关闭简历通？"],
    ["?locale=en", "en", "Close ResumeForge?"],
    ["", "en", "Close ResumeForge?"],
    ["?locale=fr", "en", "Close ResumeForge?"],
  ];
  for (const [search, expectedLang, expectedAsk] of cases) {
    const page = runCloseDialogPage(search);
    await page.settled;
    assert.equal(page.document.documentElement.lang, expectedLang, search);
    assert.equal(
      page.document.title,
      expectedLang === "zh-CN" ? "关闭简历通" : "Close ResumeForge",
      search,
    );
    assert.equal(page.element("ask-title").textContent, expectedAsk, search);
    if (search === "?locale=zh") {
      assert.equal(page.element("ask-title").textContent, "关闭简历通？");
      assert.equal(page.element("hide").textContent, "最小化到托盘");
      assert.equal(page.element("quit").textContent, "退出应用");
      assert.equal(page.element("remember-label").textContent, "记住我的选择");
    } else {
      assert.equal(page.element("hide").textContent, "Minimize to tray");
      assert.equal(page.element("quit").textContent, "Quit app");
      assert.equal(page.element("remember-label").textContent, "Remember my choice");
    }
  }
  // macOS 没有"最小化到托盘"惯例：退化为「关闭窗口」，中文同样跟随。
  const mac = runCloseDialogPage("?locale=zh", true);
  await mac.settled;
  assert.equal(mac.element("hide").textContent, "关闭窗口");
  assert.match(mac.element("ask-detail").textContent, /Dock/);
});

test("关闭卡片页面：zh / en 两份内联文案表键集合一致（漏翻一个 key 就红）", () => {
  const page = runCloseDialogPage("?locale=en");
  const copy = page.sandbox.COPY;
  assert.ok(copy && copy.zh && copy.en, "页面必须内联 zh/en 两份文案表");
  assert.deepEqual(Object.keys(copy.zh).sort(), Object.keys(copy.en).sort());
  for (const key of Object.keys(copy.zh)) {
    assert.ok(String(copy.zh[key]).trim().length > 0, `zh.${key} 不能为空`);
    assert.ok(String(copy.en[key]).trim().length > 0, `en.${key} 不能为空`);
  }
});
