// SPDX-License-Identifier: Apache-2.0
"use strict";

/**
 * A08 真实 Electron 冒烟的测试专用 preload：只暴露一个固定打印通道。
 * 不是产品 preload（产品是 desktop/preload.js）；它只用于在 smoke 窗口里
 * 真正走一次 ipcRenderer.invoke -> ipcMain.handle 的完整往返。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("smokePrint", {
  print: (payload) => ipcRenderer.invoke("resume:print-pdf", payload),
});
