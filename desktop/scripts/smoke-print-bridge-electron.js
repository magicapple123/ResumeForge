// SPDX-License-Identifier: Apache-2.0
"use strict";

/**
 * A08 真实 Electron 冒烟：在真实 Electron 运行时里走打印桥全链路
 * （真实 ipcMain 通道 + 真实 BrowserWindow + 真实 Chromium printToPDF），
 * 而不是"模块能被 require"。
 *
 * 覆盖：
 * 1. 主窗口经 IPC 打印成功，并在磁盘产出真实 PDF 文件（%PDF 头 + 有内容）；
 * 2. 非主窗口 sender 被拒绝（senderFrame/mainFrame 语义）；
 * 3. 非法 payload（非字符串 html）被拒绝；
 * 4. 超过 5 MB 的 payload 被拒绝（按 UTF-8 字节）；
 * 5. 注入极小加载预算时快速失败、不挂起、不残留隐藏窗口等待。
 *
 * 运行（CI 与本地一致）：
 *   cd desktop
 *   npx electron --disable-gpu scripts/smoke-print-bridge-electron.js
 * 退出码 0 = 全部通过；1 = 有失败项。
 */

const electronRuntime = require("electron");
if (!electronRuntime || typeof electronRuntime.app !== "object") {
  // 被 ELECTRON_RUN_AS_NODE=1 或 node 直接执行时 require("electron") 只是一个路径字符串：
  // 明确失败，避免 CI 里把"环境没跑在 Electron 下"误判为产品缺陷。
  console.error(
    "print bridge electron smoke 必须在 Electron 运行时执行：请用 npx electron scripts/smoke-print-bridge-electron.js（不要用 node）。",
  );
  process.exit(2);
}
const { app, BrowserWindow } = electronRuntime;
const { registerPrintHandler, renderPdf, MAX_HTML_BYTES } = require("../print");

// 冒烟不需要 GPU：runner/无显卡环境上禁用硬件加速，避免 Chromium 初始化抖动。
app.disableHardwareAcceleration();

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || "" });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail && !ok ? " — " + detail : ""));
}

async function main() {
  await app.whenReady();
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rf-print-smoke-"));
  const target = path.join(tmpRoot, "resume.pdf");
  const preload = path.join(__dirname, "smoke-print-preload.js");
  const webPreferences = { preload, contextIsolation: true, nodeIntegration: false, sandbox: true };

  const mainWindow = new BrowserWindow({ show: false, webPreferences });
  const foreignWindow = new BrowserWindow({ show: false, webPreferences });
  await mainWindow.loadURL("data:text/html,<html><body>smoke</body></html>");
  await foreignWindow.loadURL("data:text/html,<html><body>foreign</body></html>");

  registerPrintHandler({
    getMainWindow: () => mainWindow,
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: target }) },
    app,
  });

  const html =
    "<!doctype html><html><head><meta charset='utf-8'>" +
    "<style>body{font-family:sans-serif}</style></head>" +
    "<body><h1>ResumeForge print smoke</h1><p>hello</p></body></html>";
  const printed = await mainWindow.webContents.executeJavaScript(
    "window.smokePrint.print(" + JSON.stringify({ html, suggestedName: "smoke" }) + ")",
    true,
  );
  const bytes = await fs.readFile(target).catch(() => Buffer.alloc(0));
  check("主窗口打印返回 saved=true", printed && printed.saved === true);
  check(
    "产出真实 PDF 文件（%PDF + >1KB）",
    bytes.length > 1024 && bytes.subarray(0, 4).toString() === "%PDF",
    "bytes=" + bytes.length,
  );
  check("保存路径与请求一致", Boolean(printed && printed.path === target));

  let foreignError = null;
  try {
    await foreignWindow.webContents.executeJavaScript(
      "window.smokePrint.print(" + JSON.stringify({ html }) + ")",
      true,
    );
  } catch (error) {
    foreignError = String((error && error.message) || error);
  }
  check("非主窗口 sender 被拒绝", Boolean(foreignError && foreignError.includes("非主窗口")), foreignError || "");

  let badPayloadError = null;
  try {
    await mainWindow.webContents.executeJavaScript("window.smokePrint.print({html: 42})", true);
  } catch (error) {
    badPayloadError = String((error && error.message) || error);
  }
  check(
    "非法 payload 被拒绝",
    Boolean(badPayloadError && badPayloadError.includes("没有可打印的简历内容")),
    badPayloadError || "",
  );

  let bigPayloadError = null;
  try {
    await mainWindow.webContents.executeJavaScript(
      "window.smokePrint.print({html: 'x'.repeat(" + (MAX_HTML_BYTES + 1) + ")})",
      true,
    );
  } catch (error) {
    bigPayloadError = String((error && error.message) || error);
  }
  check("超大 payload 被拒绝", Boolean(bigPayloadError && bigPayloadError.includes("过大")), bigPayloadError || "");

  const startedAt = Date.now();
  let budgetError = null;
  try {
    await renderPdf(
      { html: "<html><body>" + "x".repeat(2048) + "</body></html>", suggestedName: "timeout" },
      {
        BrowserWindow,
        dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(tmpRoot, "t.pdf") }) },
        app,
        budgets: { load: 1 },
      },
    );
  } catch (error) {
    budgetError = String((error && error.message) || error);
  }
  const elapsed = Date.now() - startedAt;
  check(
    "超预算快速失败且不挂起（<15s）",
    Boolean(budgetError && budgetError.includes("预算") && elapsed < 15000),
    "elapsed=" + elapsed + " error=" + (budgetError || ""),
  );

  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter((item) => !item.ok);
  console.log("");
  console.log("Print bridge electron smoke: " + (results.length - failed.length) + "/" + results.length + " passed");
  for (const item of failed) console.error("FAILED: " + item.name + " " + item.detail);
  app.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("print bridge electron smoke crashed:", error);
  app.exit(1);
});
