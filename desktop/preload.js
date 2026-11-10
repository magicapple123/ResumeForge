// SPDX-License-Identifier: Apache-2.0
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("splash", {
  onStage: (callback) =>
    ipcRenderer.on("splash:stage", (_event, payload) => callback(payload)),
  // 桌面壳身份与退出桥（契约见 frontend/src/components/common/ExitAppButton.tsx：
  // `window.splash?.isDesktop` 分流文案、`window.splash?.quitApp?.()` 触发退出）。
  // isDesktop 恒为 true（浏览器里 window.splash 不存在，天然分流）；
  // quitApp 只发送**固定的**退出通道，退出本身走 main.js 的 before-quit
  // 唯一停止点（停后端 → 必要时 spawn 安装器）。contextIsolation 隔离下
  // 刻意不透传任意通道名，暴露面保持最小。
  isDesktop: true,
  quitApp: () => ipcRenderer.send("app:quit-request"),
});

/**
 * 自绘标题栏桥（问题清单 §19，主进程侧见 desktop/lib/desktop-shell-ipc.js）。
 *
 * 只暴露四个**固定**入口，不接收任意通道名：
 *  - menuAction：发菜单动作 id（编辑 / 视图 / 窗口 / 打开目录 / 关于信息），
 *    主进程的 desktop-menu.js 是唯一动作白名单；
 *  - getWindowState：窗口最大化/全屏快照（菜单文案与全屏隐藏标题栏用）；
 *  - onWindowState：主进程状态变化时推送（最大化 / 还原 / 进出全屏）；
 *  - setTheme：把实际生效主题告诉主进程，同步系统绘制的标题栏覆盖层颜色。
 * platform 只用于 macOS 红绿灯的左内边距分支，不暴露进程信息。
 */
contextBridge.exposeInMainWorld("desktopShell", {
  platform: process.platform,
  menuAction: (action) => ipcRenderer.invoke("desktop:menu-action", { action }),
  getWindowState: () => ipcRenderer.invoke("desktop:get-window-state"),
  onWindowState: (callback) =>
    ipcRenderer.on("desktop:window-state", (_event, state) => callback(state)),
  setTheme: (theme) => ipcRenderer.send("desktop:set-theme", theme),
});

/**
 * 简历打印桥（R1）：把**预览用的 HTML** 交给主进程用 Chromium 打成 PDF。
 *
 * 只暴露一个固定通道，不接收任意通道名——contextIsolation 下暴露面越小越好。
 * 浏览器里 window.resumeForge 不存在，前端据此回落到后端 PDF 引擎。
 */
contextBridge.exposeInMainWorld("resumeForge", {
  printPdf: (payload) => ipcRenderer.invoke("resume:print-pdf", payload),
});
