// SPDX-License-Identifier: Apache-2.0
"use strict";

// 桌面壳的主题裁决（WF-20）：splash 用哪一枚动画、托盘用哪一枚图标、以及
// 「托盘跟随系统主题」这个兜底开关。
//
// 为什么需要在主进程里另存一份主题：splash 在主窗口渲染进程之前就显示，那里读不到
// `themeStore`；而托盘是原生对象，只有主进程能换图。所以：
//   * 首帧（splash）用系统色 —— 还没有任何渲染进程上报过；
//   * 渲染进程挂载后经 `desktop:set-theme` 上报实际生效主题，之后托盘跟着它；
//   * 设置项 `tray_icon_follow_system`（默认关）打开后，托盘忽略应用内主题、
//     只跟 `nativeTheme.shouldUseDarkColors`。
//
// 依赖全部注入（不 require("electron")），离线用例可以直接喂假 nativeTheme。

const path = require("path");

/**
 * @param {object} deps
 * @param {object} deps.nativeTheme Electron nativeTheme（需要 shouldUseDarkColors 与 on）
 * @param {object} deps.app Electron app（只用来判断 isPackaged，决定托盘图目录）
 * @param {string} [deps.dirname] 开发态 desktop/ 目录
 * @param {function(): string} [deps.resourcesPath] 打包态 resources 目录（默认取 process）
 * @param {function(string): void} [deps.logLine]
 */
function createShellTheme(deps) {
  const {
    nativeTheme,
    app,
    dirname = __dirname,
    resourcesPath = () => process.resourcesPath,
    logLine = () => {},
  } = deps;

  // nativeTheme 在真机一定存在；离线装置/旧壳可能不给，缺省按浅色（不要因此抛错，
  // 主题裁决失败不该让壳启动失败）。
  let appTheme = nativeTheme && nativeTheme.shouldUseDarkColors ? "dark" : "light";
  let followSystem = false;
  let tray = null;

  /** 托盘此刻该不该用暗色图标：开关优先，其次应用内主题。 */
  /**
   * 托盘用哪一枚图：true = `tray-dark.ico`（深色图），false = `icon.png`（浅色图）。
   *
   * 判据是**托盘底色的明暗**，不是"应用主题是不是 dark"：深色任务栏要浅色图、浅色任务栏要
   * 深色图。2026-11-20 真机反馈"暗色模式下托盘图标在托盘里不好看"——当时的映射是
   * "暗色主题 → 深色图"，方向正好反了（深底配深图）。这里取反。
   */
  function trayIsDark() {
    const systemDark = Boolean(nativeTheme && nativeTheme.shouldUseDarkColors);
    const backgroundDark = followSystem ? systemDark : appTheme === "dark";
    return !backgroundDark;
  }

  /** 把结论交给托盘（托盘还没创建时静默）。 */
  function applyTray() {
    if (!tray || typeof tray.setTheme !== "function") return;
    tray.setTheme(trayIsDark());
  }

  /** splash 首帧的主题：这时候还没有应用内主题可选。 */
  function splashTheme() {
    return nativeTheme && nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }

  /** 暗色托盘图：打包态在 resources/ 下（extraResources），开发态在 desktop/ 根。 */
  function trayIconPath() {
    return app && app.isPackaged
      ? path.join(resourcesPath(), "tray-dark.ico")
      : path.join(dirname, "tray-dark.ico");
  }

  /**
   * 窗口图标（也是彩色托盘图）：electron-builder 可能因为 buildResources 与 asar 冲突
   * 不把 icon.png 打进 asar，所以打包态读 extraResources 的那一份。
   */
  function windowIconPath() {
    return app && app.isPackaged
      ? path.join(resourcesPath(), "icon.png")
      : path.join(dirname, "icon.png");
  }

  /** 渲染进程上报的实际生效主题（DesktopTitleBar 已经在发这条通道）。 */
  function setAppTheme(theme) {
    appTheme = theme === "dark" ? "dark" : "light";
    applyTray();
  }

  /** 兜底开关：开启后托盘只跟系统主题，并立刻按系统状态重算一次。 */
  function setFollowSystem(enabled) {
    followSystem = Boolean(enabled);
    logLine(`tray: follow system theme = ${followSystem}`);
    applyTray();
  }

  /** 系统深浅色变化：只有开关打开时才需要重算托盘。 */
  function onNativeThemeUpdated() {
    if (followSystem) applyTray();
  }

  if (nativeTheme && typeof nativeTheme.on === "function") {
    nativeTheme.on("updated", onNativeThemeUpdated);
  }

  return {
    attachTray: (manager) => {
      tray = manager;
      applyTray();
    },
    splashTheme,
    trayIconPath,
    windowIconPath,
    trayIsDark,
    setAppTheme,
    setFollowSystem,
    isFollowingSystem: () => followSystem,
    onNativeThemeUpdated,
  };
}

module.exports = { createShellTheme };
