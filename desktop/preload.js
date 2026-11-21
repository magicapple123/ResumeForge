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
 * 只暴露几个**固定**入口，不接收任意通道名：
 *  - menuAction：发菜单动作 id（编辑 / 视图 / 窗口 / 打开目录 / 诊断 / 关于信息），
 *    主进程的 desktop-menu.js 是唯一动作白名单；
 *  - getWindowState：窗口最大化/全屏/置顶/可编辑焦点快照（菜单文案、勾选态、置灰用）；
 *  - onWindowState：主进程状态变化时推送（最大化 / 还原 / 进出全屏）；
 *  - setTheme：把实际生效主题告诉主进程，同步系统绘制的标题栏覆盖层颜色；
 *  - setEditableFocus：把"焦点在不在可编辑区"报给主进程（#34F），菜单打开前读回同源实态；
 *  - setLocale：把**应用内语言**（不是系统语言）报给主进程，壳层文案据此重建
 *    （托盘 / 原生对话框 / 窗口标题）；只接受 "zh" / "en"，主进程其它值一律忽略。
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
  // 应用内语言：只发固定两个值之一，主进程侧同样校验发送方与取值。
  setLocale: (locale) => ipcRenderer.send("desktop:set-locale", locale),
  /**
   * WF-20 兜底开关：托盘图标是否跟随系统主题（设置项 tray_icon_follow_system）。
   * 只发布尔；主进程侧校验发送方，且开关状态由渲染层持有（偏好存 localStorage，
   * 与其它布尔偏好同一口径），主进程不读数据库。
   */
  setTrayIconFollowSystem: (enabled) =>
    ipcRenderer.send("desktop:set-tray-follow-system", Boolean(enabled)),
  /**
   * WF-08：开机自启（读写系统真相，见 lib/launch-at-login.js）。
   * 两个都返回 `{ supported, enabled }`：`supported=false` 表示当前平台/安装方式管不到，
   * 设置卡据此把开关渲染成不可用（不假装能切）。
   */
  getLaunchAtLogin: () => ipcRenderer.invoke("desktop:get-launch-at-login"),
  setLaunchAtLogin: (enabled) =>
    ipcRenderer.invoke("desktop:set-launch-at-login", Boolean(enabled)),
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
 * The packaged Windows window subscribes before reading its snapshot. The
 * renderer can approve only a version, never an installer path or a URL.
 * checkUpdate stays available to clients that only understand the older bridge.
 */
contextBridge.exposeInMainWorld("rfDesktop", {
  checkUpdate: () => ipcRenderer.invoke("desktop:check-update"),
  ...(process.argv?.includes("--rf-in-app-update") && {
    getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
    startUpdate: (version) => ipcRenderer.invoke("desktop:start-update", version),
    onUpdateState: (listener) => {
      const receive = (_event, state) => listener(state);
      ipcRenderer.on("desktop:update-state", receive);
      return () => ipcRenderer.removeListener("desktop:update-state", receive);
    },
  }),
});
