// SPDX-License-Identifier: Apache-2.0
"use strict";

/**
 * A08：桌面打印桥的**行为**用例（`test-print-bridge.js` 是同一模块的静态守卫）。
 *
 * 这里在 `node --test` 下直接 require `print.js`：没有 Electron 运行时也能跑，因为
 * `registerPrintHandler` / `renderPdf` 都接受注入（`ipcMain` / `BrowserWindow` /
 * `dialog` / `app` / `budgets`），而 `print.js` 的 Electron 依赖是延迟解析的。
 *
 * 覆盖的是"只能在拿不到真机时也能证明"的六条：sender 校验、payload 形状与大小、三段
 * 预算、失败路径仍销毁窗口、文件名清洗、以及安全开关的实际取值。
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const {
  DEFAULT_BUDGETS,
  MAX_HTML_BYTES,
  MAX_NAME_CHARS,
  PRINT_CHANNEL,
  isTrustedSender,
  registerPrintHandler,
  renderPdf,
  sanitizeName,
  validatePayload,
} = require(path.join(__dirname, "..", "print.js"));

const PAGE = "<html><body><p>足够长的简历正文</p></body></html>";

/** 假 BrowserWindow：记录构造参数、事件监听与销毁，便于断言收尾语义。 */
function createFakeBrowserWindow(overrides = {}) {
  const instances = [];
  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.listeners = {};
      this.contentsListeners = {};
      this.openHandler = null;
      this.destroyed = false;
      this.webContents = {
        executeJavaScript: overrides.executeJavaScript || (async () => true),
        printToPDF: overrides.printToPDF || (async () => Buffer.from("%PDF-1.4 fake")),
        setWindowOpenHandler: (handler) => {
          this.openHandler = handler;
        },
        // will-navigate / will-frame-navigate 是 webContents 事件（见 print.js 的注释）。
        on: (name, handler) => {
          (this.contentsListeners[name] = this.contentsListeners[name] || []).push(handler);
        },
      };
      this.loadURLCalls = [];
      this.loadURL = (url) => {
        this.loadURLCalls.push(url);
        return overrides.loadURL ? overrides.loadURL(url) : Promise.resolve();
      };
      instances.push(this);
    }

    on(name, handler) {
      (this.listeners[name] = this.listeners[name] || []).push(handler);
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  }
  return { FakeBrowserWindow, instances };
}

const FAKE_APP = { getPath: () => path.join("fake", "Downloads") };
const CANCELED_DIALOG = { showSaveDialog: async () => ({ canceled: true, filePath: undefined }) };
const SAVED_DIALOG = {
  showSaveDialog: async () => ({ canceled: false, filePath: path.join("fake", "out.pdf") }),
};

/** 捕获 registerPrintHandler 注册的 handler（不真的装到 Electron 上）。 */
function capturePrintHandler(dependencies = {}) {
  let registered = null;
  const ipcMain = {
    handle: (channel, handler) => {
      registered = { channel, handler };
    },
  };
  registerPrintHandler({ ipcMain, ...dependencies });
  return registered;
}

/** 主窗口的替身：只需要 `webContents.id` 与 `isDestroyed()`。 */
function fakeMainWindow(id = 7) {
  return { webContents: { id }, isDestroyed: () => false };
}

function eventFrom(id, { frame = {}, mainFrame = frame, senderFrame = frame } = {}) {
  return { sender: { id, mainFrame }, senderFrame };
}

// ===== 1. sender 校验 =====

test("注册的通道名与 preload 一致", () => {
  assert.equal(capturePrintHandler().channel, PRINT_CHANNEL);
  assert.equal(PRINT_CHANNEL, "resume:print-pdf");
});

test("非主窗口的 sender 被拒绝（明确抛错，不是静默返回）", async () => {
  const mainWindow = fakeMainWindow(7);
  const { handler } = capturePrintHandler({ getMainWindow: () => mainWindow });

  // 另一个 webContents（比如被打开的 devtools 页面 / 其它窗口）。
  await assert.rejects(handler(eventFrom(8), { html: PAGE }), /拒绝来自非主窗口的打印请求/);
  // 同一个 webContents 的子 frame：sender.id 相同，但 senderFrame !== mainFrame。
  const childFrame = {};
  await assert.rejects(
    handler(
      { sender: { id: 7, mainFrame: childFrame }, senderFrame: {} },
      { html: PAGE },
    ),
    /拒绝来自非主窗口的打印请求/,
  );
  // 拿不到 frame 信息时 fail closed。
  await assert.rejects(
    handler({ sender: { id: 7, mainFrame: undefined }, senderFrame: undefined }, { html: PAGE }),
    /拒绝来自非主窗口的打印请求/,
  );
});

test("主窗口不存在（尚未创建 / 已销毁）时同样拒绝", async () => {
  const { handler } = capturePrintHandler({ getMainWindow: () => null });
  await assert.rejects(handler(eventFrom(7), { html: PAGE }), /拒绝来自非主窗口的打印请求/);

  const destroyed = { webContents: { id: 7 }, isDestroyed: () => true };
  const second = capturePrintHandler({ getMainWindow: () => destroyed });
  await assert.rejects(second.handler(eventFrom(7), { html: PAGE }), /拒绝来自非主窗口的打印请求/);
});

test("isTrustedSender 只认主窗口的顶层 frame", () => {
  const mainWindow = fakeMainWindow(7);
  assert.equal(isTrustedSender(eventFrom(7), mainWindow), true);
  assert.equal(isTrustedSender(eventFrom(8), mainWindow), false);
  assert.equal(isTrustedSender(null, mainWindow), false);
  assert.equal(isTrustedSender({}, mainWindow), false);
  assert.equal(isTrustedSender(eventFrom(7), { webContents: {}, isDestroyed: () => false }), false);
  assert.equal(isTrustedSender(eventFrom(7), {}), false);
});

test("受信任的请求能走完整条桥（sender 通过后进入渲染）", async () => {
  const mainWindow = fakeMainWindow(7);
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow();
  const { handler } = capturePrintHandler({
    getMainWindow: () => mainWindow,
    BrowserWindow: FakeBrowserWindow,
    dialog: CANCELED_DIALOG,
    app: FAKE_APP,
  });

  const result = await handler(eventFrom(7), { html: PAGE });
  assert.deepEqual(result, { saved: false, canceled: true });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].loadURLCalls[0].startsWith("data:text/html"), true);
});

// ===== 2. payload 形状与大小 =====

test("payload 非字符串 / 空串 / 非对象都被拒绝", () => {
  for (const payload of [null, undefined, "<p>x</p>", [], 42]) {
    assert.throws(() => validatePayload(payload), /没有可打印的简历内容/);
  }
  assert.throws(() => validatePayload({ html: 123 }), /没有可打印的简历内容/);
  assert.throws(() => validatePayload({ html: "" }), /没有可打印的简历内容/);
  assert.throws(() => validatePayload({ html: "   \n\t " }), /没有可打印的简历内容/);
});

test("payload 超过 5 MB（UTF-8 字节）被拒绝，恰好 5 MB 仍放行", () => {
  const limit = validatePayload({ html: "a".repeat(MAX_HTML_BYTES) });
  assert.equal(limit.html.length, MAX_HTML_BYTES);

  const tooBig = "a".repeat(MAX_HTML_BYTES + 1);
  assert.throws(() => validatePayload({ html: tooBig }), /简历内容过大/);
  // 口径是字节而不是字符：中文每字 3 字节，字符数远小于上限也要拒。
  const chineseBytes = "简".repeat(Math.floor(MAX_HTML_BYTES / 3) + 1);
  assert.throws(() => validatePayload({ html: chineseBytes }), /简历内容过大/);
});

test("suggestedName 非字符串时忽略（不因文件名让打印失败）", () => {
  assert.equal(validatePayload({ html: PAGE }).suggestedName, "");
  assert.equal(validatePayload({ html: PAGE, suggestedName: 123 }).suggestedName, "");
  assert.equal(validatePayload({ html: PAGE, suggestedName: ["x"] }).suggestedName, "");
  assert.equal(validatePayload({ html: PAGE, suggestedName: "我的简历" }).suggestedName, "我的简历");
});

test("超限 payload 在 IPC 层也被拒绝（不会进入渲染）", async () => {
  const mainWindow = fakeMainWindow(7);
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow();
  const { handler } = capturePrintHandler({
    getMainWindow: () => mainWindow,
    BrowserWindow: FakeBrowserWindow,
    dialog: CANCELED_DIALOG,
    app: FAKE_APP,
  });
  await assert.rejects(
    handler(eventFrom(7), { html: "a".repeat(MAX_HTML_BYTES + 1) }),
    /简历内容过大/,
  );
  assert.equal(instances.length, 0); // 没有为它创建隐藏窗口
});

// ===== 3. 预算 =====

test("loadURL 永不 resolve 时在注入预算内超时，并销毁窗口", async () => {
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow({
    loadURL: () => new Promise(() => {}),
  });
  const startedAt = Date.now();
  await assert.rejects(
    renderPdf(
      { html: PAGE },
      {
        BrowserWindow: FakeBrowserWindow,
        dialog: CANCELED_DIALOG,
        app: FAKE_APP,
        budgets: { load: 30 },
      },
    ),
    /加载打印页面超过 30 毫秒预算/,
  );
  assert.ok(Date.now() - startedAt < 5_000, "预算必须真的到期，不能等真实 15 秒");
  assert.equal(instances.length, 1);
  assert.equal(instances[0].destroyed, true);
});

test("printToPDF 超时同样被预算打断并销毁窗口", async () => {
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow({
    printToPDF: () => new Promise(() => {}),
  });
  await assert.rejects(
    renderPdf(
      { html: PAGE },
      {
        BrowserWindow: FakeBrowserWindow,
        dialog: CANCELED_DIALOG,
        app: FAKE_APP,
        budgets: { print: 30 },
      },
    ),
    /生成 PDF超过 30 毫秒预算/,
  );
  assert.equal(instances[0].destroyed, true);
});

test("默认预算就是 15s / 10s / 30s（保存对话框不在预算内）", () => {
  assert.deepEqual(DEFAULT_BUDGETS, { load: 15_000, ready: 10_000, print: 30_000 });
});

test("字体/图片等待超时不致命：仍然继续打印", async () => {
  const { FakeBrowserWindow } = createFakeBrowserWindow({
    executeJavaScript: () => new Promise(() => {}),
  });
  const result = await renderPdf(
    { html: PAGE },
    {
      BrowserWindow: FakeBrowserWindow,
      dialog: CANCELED_DIALOG,
      app: FAKE_APP,
      budgets: { ready: 20 },
    },
  );
  assert.deepEqual(result, { saved: false, canceled: true });
});

// ===== 4. 失败路径的收尾（finally 语义） =====

test("printToPDF reject 时抛可读错误，窗口仍被销毁", async () => {
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow({
    printToPDF: async () => {
      throw new Error("PDF 引擎炸了");
    },
  });
  await assert.rejects(
    renderPdf(
      { html: PAGE },
      { BrowserWindow: FakeBrowserWindow, dialog: CANCELED_DIALOG, app: FAKE_APP },
    ),
    /打印失败（生成 PDF）：PDF 引擎炸了/,
  );
  assert.equal(instances[0].destroyed, true);
});

test("loadURL reject 时抛可读错误，窗口仍被销毁", async () => {
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow({
    loadURL: async () => {
      throw new Error("ERR_FAILED");
    },
  });
  await assert.rejects(
    renderPdf(
      { html: PAGE },
      { BrowserWindow: FakeBrowserWindow, dialog: CANCELED_DIALOG, app: FAKE_APP },
    ),
    /打印失败（加载页面）：ERR_FAILED/,
  );
  assert.equal(instances[0].destroyed, true);
});

test("用户取消保存返回 {saved:false, canceled:true}，窗口仍被销毁", async () => {
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow();
  const result = await renderPdf(
    { html: PAGE },
    { BrowserWindow: FakeBrowserWindow, dialog: CANCELED_DIALOG, app: FAKE_APP },
  );
  assert.deepEqual(result, { saved: false, canceled: true });
  assert.equal(instances[0].destroyed, true);
});

test("保存成功返回 {saved:true, path}，窗口仍被销毁（保存对话框不设预算）", async () => {
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow();
  const written = [];
  const result = await renderPdf(
    { html: PAGE, suggestedName: "我的简历" },
    {
      BrowserWindow: FakeBrowserWindow,
      dialog: SAVED_DIALOG,
      app: FAKE_APP,
      // 注入写盘实现：用例不落任何真实文件。
      writeFile: async (target, data) => {
        written.push({ target, bytes: data.length });
      },
    },
  );
  assert.equal(result.saved, true);
  assert.equal(result.path, path.join("fake", "out.pdf"));
  assert.equal(written.length, 1);
  assert.ok(written[0].bytes > 0);
  assert.equal(instances[0].destroyed, true);
});

// ===== 5. 窗口能力收窄与安全开关 =====

test("隐藏窗口保留三项安全开关，并禁掉导航与新窗口", async () => {
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow();
  await renderPdf(
    { html: PAGE },
    { BrowserWindow: FakeBrowserWindow, dialog: CANCELED_DIALOG, app: FAKE_APP },
  );
  const [window] = instances;
  assert.equal(window.options.show, false);
  assert.deepEqual(window.options.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false,
  });

  // will-navigate / will-frame-navigate：页面自己想跳走时必须被 preventDefault 掐掉。
  for (const eventName of ["will-navigate", "will-frame-navigate"]) {
    const listeners = window.contentsListeners[eventName] || [];
    assert.equal(listeners.length, 1, `${eventName} 必须挂在 webContents 上`);
    let prevented = false;
    listeners[0]({ preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
  }

  // 新窗口一律 deny。
  assert.equal(typeof window.openHandler, "function");
  assert.deepEqual(window.openHandler({ url: "https://example.com" }), { action: "deny" });
});

test("打印输入只能是应用生成的 HTML，不接受 URL", () => {
  // validatePayload 只认 `html` 字段：多给的 `url` 之类不会被当成输入。
  const normalized = validatePayload({ html: PAGE, url: "https://evil.example/x" });
  assert.deepEqual(Object.keys(normalized).sort(), ["html", "suggestedName"]);
});

// ===== 6. 文件名清洗 =====

test("sanitizeName 把 \\ / : * ? \" < > | 换成 - 并截断到 60 个字符", () => {
  assert.equal(sanitizeName('a\\b/c:d*e?f"g<h>i|j'), "a-b-c-d-e-f-g-h-i-j.pdf");
  assert.equal(sanitizeName("我的简历"), "我的简历.pdf");
  assert.equal(sanitizeName("x".repeat(200)), `${"x".repeat(MAX_NAME_CHARS)}.pdf`);
  assert.equal(sanitizeName("../evil"), "..-evil.pdf"); // 分隔符变 - 之后不再是路径
  // 前端本来就带 `.pdf`（`${recordId}-简历.pdf`）：不能叠成 `.pdf.pdf`。
  assert.equal(sanitizeName("123-简历.pdf"), "123-简历.pdf");
  assert.equal(sanitizeName("Report.PDF"), "Report.pdf");
  assert.equal(sanitizeName(""), "简历.pdf");
  assert.equal(sanitizeName("   "), "简历.pdf");
  assert.equal(sanitizeName(undefined), "简历.pdf");
  assert.equal(sanitizeName(42), "简历.pdf");
  assert.equal(sanitizeName("line\nbreak"), "linebreak.pdf");
});
