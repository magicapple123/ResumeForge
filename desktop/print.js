// SPDX-License-Identifier: Apache-2.0
"use strict";

/**
 * 简历 PDF 打印（R1）：用 Electron 自带的 Chromium 把**预览用的那份 HTML**打成 PDF。
 *
 * 为什么不是后端那个 PDF 引擎：预览是 HTML/CSS 排版，后端是用绘图 API 逐行摆字——
 * 两套排版必然在分页、行距、孤行上出现细微差异。这里让两者共用同一个渲染引擎
 * （Chromium），"预览看到的就是导出的"才有机会成立。
 *
 * 隔离与安全（A08 加固，逐条对应验收项）：
 * - **只接受主窗口**：`ipcMain.handle` 的回调先过 `isTrustedSender`——`event.sender.id`
 *   必须等于主窗口 `webContents.id`，且 `event.senderFrame === event.sender.mainFrame`
 *   （iframe / webview / 被注入的页面都拿不到这条桥）。不匹配时**抛错**而不是静默返回，
 *   否则前端会把"被拒绝"误读成"用户取消了"。
 * - **只吃应用生成的 HTML**：不接收 URL，`payload.html` 之外没有别的输入面；隐藏窗口
 *   还额外禁掉导航（`will-navigate`）与新窗口（`setWindowOpenHandler` → deny）。
 * - **有界**：加载 15s、等字体/图片 10s、`printToPDF` 30s（`DEFAULT_BUDGETS`）；任一
 *   超时或异常都会在 `finally` 里销毁隐藏窗口，并抛出带阶段名的可读错误。
 *   保存对话框**不设预算**——等用户决定多久都是正常的。
 * - `nodeIntegration: false` + `contextIsolation: true` + `sandbox: true`（`WEB_PREFERENCES`
 *   是这个窗口唯一的一份 webPreferences）。
 *
 * 打印参数：A4、`printBackground: true`（品牌色块与分隔线要打出来）、页边距为零
 * （留白由简历模板自己的 padding 决定，避免"双重边距"）。
 *
 * 可测性：纯逻辑（`sanitizeName` / `validatePayload` / `isTrustedSender`）单独导出，
 * `registerPrintHandler` 允许注入 `{ ipcMain, BrowserWindow, dialog, app, getMainWindow,
 * budgets }`，`renderPdf` 允许注入 `{ BrowserWindow, dialog, app, budgets }`——
 * 因此 `node --test` 下（没有 Electron 运行时）也能跑完整行为链。
 */

const { writeFile } = require("node:fs/promises");
const path = require("node:path");

const PRINT_CHANNEL = "resume:print-pdf";

/** 等字体与图片解码完成：否则第一页可能出现"少字/缺图"的半成品。 */
const READY_SCRIPT = `
  (async () => {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch {} }
    const images = Array.from(document.images || []);
    await Promise.all(images.map((img) => (img.complete ? null : new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    }))));
    return true;
  })();
`;

/**
 * HTML 上限 5 MB，**口径是 UTF-8 字节数**（`Buffer.byteLength(html, "utf8")`，不是字符数）：
 * 简历 HTML 已内联样式与图片，正常在几百 KB 量级；5 MB 之外只可能是异常输入。
 */
const MAX_HTML_BYTES = 5 * 1024 * 1024;
/** 文件名主体截断到 60 个字符（未计 `.pdf` 后缀）。 */
const MAX_NAME_CHARS = 60;

/** 各阶段预算（毫秒）。保存对话框刻意不在其中：那一段的等待主体是用户。 */
const DEFAULT_BUDGETS = Object.freeze({
  load: 15_000,
  ready: 10_000,
  print: 30_000,
});

/** 隐藏打印窗口的 webPreferences——只有这一份，别在别处再拼一套。 */
const WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  // 打印不需要后台节流：隐藏窗口被节流会让字体/图片迟迟不就绪。
  backgroundThrottling: false,
});

/**
 * 延迟解析 Electron：`node --test` 直接 require 本模块时没有 Electron 运行时
 * （`require("electron")` 返回二进制路径字符串），模块加载本身不该因此失败。
 */
function loadElectron() {
  try {
    const electron = require("electron");
    return electron && typeof electron === "object" ? electron : {};
  } catch {
    return {};
  }
}

/** 预算的可读写法：15000 → "15 秒"，20 → "20 毫秒"。 */
function formatBudget(milliseconds) {
  return milliseconds >= 1000 ? `${milliseconds / 1000} 秒` : `${milliseconds} 毫秒`;
}

/**
 * 文件名清洗：路径分隔符与 Windows 保留字符替换成 `-`，主体截断到
 * {@link MAX_NAME_CHARS} 个字符，再补 `.pdf`。
 *
 * 非字符串（含 `undefined` / 数字 / 对象）按"没给名字"处理，回落 `简历.pdf`——
 * 文件名不该成为打印失败的理由。
 *
 * @param {unknown} name
 * @returns {string} 形如 `我的简历.pdf`
 */
function sanitizeName(name) {
  const raw = typeof name === "string" ? name : "";
  // 控制字符（含换行）在文件名里没有意义，先删掉再替换保留字符。
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  // 前端传的是 `xxx-简历.pdf`（自带后缀）：先去掉再统一补，避免出现 `.pdf.pdf`。
  const base = cleaned.replace(/\.pdf$/i, "") || "简历";
  const safe = base.replace(/[\\/:*?"<>|]/g, "-").slice(0, MAX_NAME_CHARS) || "简历";
  return `${safe}.pdf`;
}

/**
 * 校验并归一化 IPC payload（形状 + 大小两个维度）。
 *
 * @param {unknown} payload
 * @returns {{ html: string, suggestedName: string }}
 * @throws {Error} 内容缺失 / 不是字符串 / 超过 {@link MAX_HTML_BYTES}
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("没有可打印的简历内容");
  }
  const html = payload.html;
  if (typeof html !== "string" || html.trim() === "") {
    throw new Error("没有可打印的简历内容");
  }
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_HTML_BYTES) {
    throw new Error(
      `简历内容过大（${bytes} 字节，上限 ${MAX_HTML_BYTES} 字节）：请先关闭图片再打印`,
    );
  }
  // 名字是"可选提示"：类型不对就忽略（回落默认名），长度由 sanitizeName 截断。
  const suggestedName = typeof payload.suggestedName === "string" ? payload.suggestedName : "";
  return { html, suggestedName };
}

/**
 * 打印请求是否来自主窗口的**顶层** frame。
 *
 * 三个条件缺一不可：有 `event.sender`、它的 id 等于主窗口 `webContents.id`、
 * `senderFrame` 就是 `sender.mainFrame`（子 frame 拿到的是同一个 webContents，
 * 只有 frame 身份能区分）。任何一项无法确认都按不可信处理（fail closed）。
 *
 * @param {{ sender?: { id?: number, mainFrame?: unknown }, senderFrame?: unknown }} event
 * @param {Electron.BrowserWindow | null} mainWindow
 * @returns {boolean}
 */
function isTrustedSender(event, mainWindow) {
  if (!event || !event.sender) return false;
  if (!mainWindow || typeof mainWindow.isDestroyed !== "function") return false;
  if (mainWindow.isDestroyed()) return false;
  const contents = mainWindow.webContents;
  if (!contents || contents.id === undefined || contents.id === null) return false;
  if (event.sender.id !== contents.id) return false;
  const frame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  if (!frame || !mainFrame) return false;
  return frame === mainFrame;
}

/**
 * 给单次操作套墙钟预算。
 *
 * @template T
 * @param {Promise<T>} task
 * @param {number} budgetMs
 * @param {string} label 出现在超时错误里的阶段名
 * @returns {Promise<T>}
 */
async function withBudget(task, budgetMs, label) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error(`打印预算配置非法（${label}：${budgetMs}）`);
  }
  let timer = null;
  const expired = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label}超过 ${formatBudget(budgetMs)}预算`));
    }, budgetMs);
  });
  try {
    return await Promise.race([task, expired]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** 给错误加上阶段名，保证抛到前端的永远是"发生了什么 + 哪一步"。 */
function readablePrintError(error, stage) {
  const detail = error && error.message ? error.message : String(error);
  const wrapped = new Error(`打印失败（${stage}）：${detail}`);
  wrapped.cause = error;
  return wrapped;
}

/**
 * 收窄隐藏窗口的能力：它只该渲染我们给的那一份 HTML。
 *
 * 注意 `will-navigate` 是 **webContents** 事件（`BrowserWindow` 上没有同名事件，
 * 挂错对象等于没挂——桌面侧没有真机测试，这条尤其容易"看起来加了"）：
 * 页面自身的跳转（`location=` / meta refresh）在发起前被 preventDefault 掐掉，
 * 子 frame 的导航由 `will-frame-navigate` 兜住，`setWindowOpenHandler` 一律 deny，
 * 简历 HTML 里就算有 `target="_blank"` 也开不出新窗口。
 */
function hardenWindow(printWindow) {
  const contents = printWindow.webContents;
  if (!contents || typeof contents.on !== "function") return;
  const blockNavigation = (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
  };
  contents.on("will-navigate", blockNavigation);
  contents.on("will-frame-navigate", blockNavigation);
  if (typeof contents.setWindowOpenHandler === "function") {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  }
}

/** 保存对话框的默认路径：`<下载目录>/<清洗后的名字>.pdf`；拿不到目录就只给文件名。 */
function defaultSavePath(appApi, suggestedName) {
  const fileName = sanitizeName(suggestedName);
  if (appApi && typeof appApi.getPath === "function") {
    try {
      return path.join(appApi.getPath("downloads"), fileName);
    } catch {
      return fileName;
    }
  }
  return fileName;
}

/**
 * 渲染并保存。失败时抛出可读错误；隐藏窗口无论成败都会销毁。
 *
 * @param {{ html?: string, suggestedName?: string }} payload
 * @param {{
 *   BrowserWindow?: unknown,
 *   dialog?: unknown,
 *   app?: unknown,
 *   budgets?: Partial<typeof DEFAULT_BUDGETS>,
 *   writeFile?: (target: string, data: Uint8Array) => Promise<void>,
 * }} [options] 仅供测试注入；生产路径留空走 `require("electron")` / `node:fs/promises`
 * @returns {Promise<{saved: boolean, path?: string, canceled?: boolean}>}
 */
async function renderPdf(payload, options = {}) {
  const electron = loadElectron();
  const BrowserWindowClass = options.BrowserWindow || electron.BrowserWindow;
  const dialogApi = options.dialog || electron.dialog;
  const appApi = options.app || electron.app;
  const writeFileImpl = options.writeFile || writeFile;
  const budgets = { ...DEFAULT_BUDGETS, ...(options.budgets || {}) };

  if (typeof BrowserWindowClass !== "function") {
    throw new Error("打印桥需要 Electron 运行时：BrowserWindow 不可用");
  }
  if (!dialogApi || typeof dialogApi.showSaveDialog !== "function") {
    throw new Error("打印桥需要 Electron 运行时：dialog 不可用");
  }
  const { html, suggestedName } = validatePayload(payload);

  const printWindow = new BrowserWindowClass({
    show: false,
    webPreferences: { ...WEB_PREFERENCES },
  });
  hardenWindow(printWindow);
  try {
    // data: URL 而不是临时文件：不落盘、不留痕，窗口关掉就没了。
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    try {
      await withBudget(printWindow.loadURL(url), budgets.load, "加载打印页面");
    } catch (error) {
      throw readablePrintError(error, "加载页面");
    }

    // 字体/图片没就绪只影响观感，不该让整次打印失败（用户宁可少一张图也不想拿不到
    // PDF），所以这里只做**有界等待**：超时或缺接口都继续往下打印。
    try {
      await withBudget(
        printWindow.webContents.executeJavaScript(READY_SCRIPT, true),
        budgets.ready,
        "等待字体与图片",
      );
    } catch {
      // 继续打印：READY_SCRIPT 是"尽力而为"，不是正确性前提。
    }

    let pdf = null;
    try {
      pdf = await withBudget(
        printWindow.webContents.printToPDF({
          printBackground: true,
          pageSize: "A4",
          margins: { marginType: "none" },
          preferCSSPageSize: false,
        }),
        budgets.print,
        "生成 PDF",
      );
    } catch (error) {
      throw readablePrintError(error, "生成 PDF");
    }

    // 保存对话框不设预算：等用户决定多久都是正常的。
    const { canceled, filePath } = await dialogApi.showSaveDialog({
      title: "保存简历 PDF",
      defaultPath: defaultSavePath(appApi, suggestedName),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) return { saved: false, canceled: true };

    try {
      await writeFileImpl(filePath, pdf);
    } catch (error) {
      throw readablePrintError(error, "保存文件");
    }
    return { saved: true, path: filePath };
  } finally {
    // 超时/异常/成功三条路都要销毁隐藏窗口；销毁本身再出错也不能盖住上面那条错误。
    try {
      if (typeof printWindow.isDestroyed !== "function" || !printWindow.isDestroyed()) {
        printWindow.destroy();
      }
    } catch {
      // 忽略：原始错误更重要。
    }
  }
}

/**
 * 注册打印通道。
 *
 * @param {(() => Electron.BrowserWindow | null) | {
 *   ipcMain?: unknown,
 *   getMainWindow?: () => Electron.BrowserWindow | null,
 *   BrowserWindow?: unknown,
 *   dialog?: unknown,
 *   app?: unknown,
 *   budgets?: Partial<typeof DEFAULT_BUDGETS>,
 *   writeFile?: (target: string, data: Uint8Array) => Promise<void>,
 * }} [dependencies] 可直接传 `() => mainWindow`，也可传注入对象（生产只传前者）
 */
function registerPrintHandler(dependencies = {}) {
  const resolved = typeof dependencies === "function" ? { getMainWindow: dependencies } : dependencies;
  const electron = loadElectron();
  const ipc = resolved.ipcMain || electron.ipcMain;
  if (!ipc || typeof ipc.handle !== "function") {
    throw new Error("打印桥需要 Electron 运行时：ipcMain 不可用");
  }
  const getMainWindow =
    typeof resolved.getMainWindow === "function" ? resolved.getMainWindow : () => null;

  ipc.handle(PRINT_CHANNEL, async (event, payload) => {
    if (!isTrustedSender(event, getMainWindow())) {
      // 明确报错而不是静默返回：静默会让前端把它当成"用户取消了保存"。
      throw new Error("拒绝来自非主窗口的打印请求");
    }
    return renderPdf(payload, {
      BrowserWindow: resolved.BrowserWindow,
      dialog: resolved.dialog,
      app: resolved.app,
      budgets: resolved.budgets,
      writeFile: resolved.writeFile,
    });
  });
}

module.exports = {
  DEFAULT_BUDGETS,
  MAX_HTML_BYTES,
  MAX_NAME_CHARS,
  PRINT_CHANNEL,
  READY_SCRIPT,
  isTrustedSender,
  registerPrintHandler,
  renderPdf,
  sanitizeName,
  validatePayload,
};
