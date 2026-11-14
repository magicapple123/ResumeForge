// SPDX-License-Identifier: Apache-2.0
"use strict";

// 自绘关闭卡片的 preload（Q11）：只暴露两个方法，不给渲染进程 Node 能力。
// 卡片内容是本地静态文件，但仍然按最小权限走 contextBridge——
// `close-dialog.html` 里只有 `window.closeDialog.resolve(...)` 与 `.platform()`。

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("closeDialog", {
  platform: () => ipcRenderer.invoke("close-dialog:platform"),
  resolve: (payload) => ipcRenderer.send("close-dialog:resolve", payload),
});
