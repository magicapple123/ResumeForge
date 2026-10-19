"use strict";

/**
 * 简历 PDF 打印（R1）：用 Electron 自带的 Chromium 把**预览用的那份 HTML**打成 PDF。
 *
 * 为什么不是后端那个 PDF 引擎：预览是 HTML/CSS 排版，后端是用绘图 API 逐行摆字——
 * 两套排版必然在分页、行距、孤行上出现细微差异。这里让两者共用同一个渲染引擎
 * （Chromium），"预览看到的就是导出的"才有机会成立。
 *
 * 隔离与安全：
 * - 隐藏窗口 `show: false`，用户看不到也不抢焦点；
 * - `nodeIntegration: false` + `contextIsolation: true`，HTML 里就算有脚本也拿不到 Node；
 * - HTML 来自**本应用的导出接口**（已内联样式与图片），不接受任意 URL。
 *
 * 打印参数：A4、`printBackground: true`（品牌色块与分隔线要打出来）、页边距为零
 * （留白由简历模板自己的 padding 决定，避免"双重边距"）。
 */

const { BrowserWindow, dialog, ipcMain } = require("electron");
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

function sanitizeName(name) {
  const base = String(name || "简历").trim() || "简历";
  return `${base.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60)}.pdf`;
}

/**
 * @param {{ html?: string, suggestedName?: string }} payload
 * @returns {Promise<{saved: boolean, path?: string, canceled?: boolean}>}
 */
async function renderPdf(payload) {
  const html = payload && payload.html;
  if (typeof html !== "string" || html.trim() === "") {
    throw new Error("没有可打印的简历内容");
  }
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // 打印不需要后台节流：隐藏窗口被节流会让字体/图片迟迟不就绪。
      backgroundThrottling: false,
    },
  });
  try {
    // data: URL 而不是临时文件：不落盘、不留痕，窗口关掉就没了。
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await window.webContents.executeJavaScript(READY_SCRIPT, true).catch(() => {});

    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "none" },
      preferCSSPageSize: false,
    });

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "保存简历 PDF",
      defaultPath: path.join(
        require("electron").app.getPath("downloads"),
        sanitizeName(payload.suggestedName),
      ),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) return { saved: false, canceled: true };

    await writeFile(filePath, pdf);
    return { saved: true, path: filePath };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

function registerPrintHandler() {
  ipcMain.handle(PRINT_CHANNEL, async (_event, payload) => renderPdf(payload));
}

module.exports = { PRINT_CHANNEL, registerPrintHandler, renderPdf };
