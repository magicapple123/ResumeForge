// SPDX-License-Identifier: Apache-2.0
"use strict";

// 自绘托盘菜单的 preload：只暴露三个方法，不给渲染进程 Node 能力。
//
// `tray-menu.html` 只有三种行为：收模型（onModel）、选中某项（choose）、关闭（close）。
// 尺寸测量由主进程用 executeJavaScript 完成，所以这里不需要第四个方法——少一个方法
// 就少一条可以被打穿的边界。

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trayMenu", {
  onModel: (callback) => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("tray-menu:model", (_event, payload) => callback(payload));
  },
  choose: (id) => ipcRenderer.send("tray-menu:choose", String(id)),
  close: () => ipcRenderer.send("tray-menu:close"),
});
