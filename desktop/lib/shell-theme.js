// SPDX-License-Identifier: Apache-2.0
"use strict";

// 桌面壳的主题裁决（WF-20）：只负责 splash 用哪一枚动画、窗口用哪一枚图标。
//
// 为什么需要在主进程里另存一份主题：splash 在主窗口渲染进程之前就显示，那里读不到
// `themeStore`。所以首帧（splash）用系统色 —— 还没有任何渲染进程上报过。
//
// **托盘图标固定一枚浅色图（2026-11-20 决定）**：不再按任务栏底色换图。原来那套
// "深色任务栏配深色图"的映射让图标在浅色任务栏下发闷，用户明确要求永远只用浅色那枚
// （接受浅色任务栏下对比偏低）。因此这里既没有 `trayIsDark()`，也不再有
// `setImage` 调用 —— 托盘图标只在 `new Tray(iconPath)` 时确定一次。
//
// 依赖全部注入（不 require("electron")），离线用例可以直接喂假 nativeTheme。

const path = require("path");

/**
 * @param {object} deps
 * @param {object} deps.nativeTheme Electron nativeTheme（需要 shouldUseDarkColors 与 on）
 * @param {object} deps.app Electron app（只用来判断 isPackaged，决定图标目录）
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

  /** splash 首帧的主题：这时候还没有应用内主题可选。 */
  function splashTheme() {
    return nativeTheme && nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }

  /**
   * 窗口图标：electron-builder 可能因为 buildResources 与 asar 冲突不把 icon.png
   * 打进 asar，所以打包态读 extraResources 的那一份。
   *
   * 托盘用的是按此图导出的多尺寸 `tray.ico`（16/20/24/32/48/64），路径由
   * lib/tray-menu.js 的 `resolveTrayIconPath()` 裁决（同样读 extraResources）。
   */
  function windowIconPath() {
    return app && app.isPackaged
      ? path.join(resourcesPath(), "icon.png")
      : path.join(dirname, "icon.png");
  }

  /** 渲染进程上报的实际生效主题（DesktopTitleBar 已经在发这条通道）。 */
  function setAppTheme(theme) {
    appTheme = theme === "dark" ? "dark" : "light";
  }

  /** 兜底开关：开启后应用内主题只跟系统（托盘图不再参与，这枚开关只影响主题裁决）。 */
  function setFollowSystem(enabled) {
    followSystem = Boolean(enabled);
    logLine(`theme: follow system = ${followSystem}`);
  }

  /**
   * 系统深浅色变化。
   *
   * 托盘不再换图，但这个订阅必须保留：它仍是"应用内主题跟随系统"这条路径在主进程
   * 侧的触发点（开关打开时把新的系统判定同步进 `appTheme`）。去掉订阅会让
   * `setFollowSystem(true)` 变成只有日志的摆设。
   */
  function onNativeThemeUpdated() {
    if (!followSystem) return;
    appTheme = nativeTheme && nativeTheme.shouldUseDarkColors ? "dark" : "light";
    logLine(`theme: system updated -> ${appTheme}`);
  }

  if (nativeTheme && typeof nativeTheme.on === "function") {
    nativeTheme.on("updated", onNativeThemeUpdated);
  }

  return {
    splashTheme,
    windowIconPath,
    setAppTheme,
    setFollowSystem,
    isFollowingSystem: () => followSystem,
    onNativeThemeUpdated,
  };
}

module.exports = { createShellTheme };
