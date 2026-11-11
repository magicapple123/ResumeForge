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
 * 只暴露五个**固定**入口，不接收任意通道名：
 *  - menuAction：发菜单动作 id（编辑 / 视图 / 窗口 / 打开目录 / 诊断 / 关于信息），
 *    主进程的 desktop-menu.js 是唯一动作白名单；
 *  - getWindowState：窗口最大化/全屏/置顶/可编辑焦点快照（菜单文案、勾选态、置灰用）；
 *  - onWindowState：主进程状态变化时推送（最大化 / 还原 / 进出全屏）；
 *  - setTheme：把实际生效主题告诉主进程，同步系统绘制的标题栏覆盖层颜色；
 *  - setEditableFocus：把"焦点在不在可编辑区"报给主进程（#34F），菜单打开前读回同源实态。
 * platform 只用于 macOS 红绿灯的左内边距分支，不暴露进程信息。
 */
contextBridge.exposeInMainWorld("desktopShell", {
  platform: process.platform,
  menuAction: (action) => ipcRenderer.invoke("desktop:menu-action", { action }),
  getWindowState: () => ipcRenderer.invoke("desktop:get-window-state"),
  onWindowState: (callback) =>
    ipcRenderer.on("desktop:window-state", (_event, state) => callback(state)),
  setTheme: (theme) => ipcRenderer.send("desktop:set-theme", theme),
  // #34F：只发一个布尔，不接受任意载荷；主进程侧同样校验发送方必须是主窗口。
  setEditableFocus: (editable) => ipcRenderer.send("desktop:editable-focus", Boolean(editable)),
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

/**
 * 桌面版的手动更新入口（P2-2 的 B 方案）。
 *
 * 设置页那张「软件更新」卡片在桌面形态下没有"下载/安装"按钮（更新包补不齐 payload），
 * 真正能升级的是壳里的 updater。此前用户只能靠菜单或 update.cmd，卡片上的「检查更新」
 * 点了只会在页面里问后端、给一份和实际升级无关的结果。现在这个桥把它接回主进程：
 *
 *   checkUpdate() → ipcMain 「desktop:check-update」→ runManualUpdateCheck(mainWindow, ...)
 *   → 系统弹窗给出结论（有新版就弹「立即更新/暂不」，已是最新就弹「已是最新版本」）。
 *
 * **能力探测只能看这个对象在不在**，不要看平台/UA：2.1 及更早的壳没有这条通道，
 * 前端探测不到就回退到设置页的三段式文字说明（A 方案）。也就是说 B 从 2.1 → 2.2 才生效，
 * 2.0 旧壳的用户仍然只能靠文字说明 + 手动 Setup.exe。
 *
 * 与其它桥同一纪律：只暴露一个**固定**通道名，不接收渲染层传来的任意通道 / 任意参数，
 * 发送方在主进程侧（desktop/lib/desktop-shell-ipc.js）校验必须是主窗口。
 */
contextBridge.exposeInMainWorld("rfDesktop", {
  checkUpdate: () => ipcRenderer.invoke("desktop:check-update"),
});
