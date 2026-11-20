// SPDX-License-Identifier: Apache-2.0
"use strict";

// lib/shell-theme.js 的离线用例（WF-20 → 2026-11-20 收敛）。
//
// 契约变了：托盘图标**固定一枚浅色版**，不再随应用内主题 / 系统主题换图。
// 所以这里不再有"浅/深组合矩阵"，改为断言：
//   1. shell-theme 根本不持有托盘句柄，也就没有 setTheme / setImage 可调用；
//   2. `nativeTheme.on("updated")` 这条订阅仍在（它驱动"应用内主题跟随系统"）；
//   3. 图标路径：窗口图标走 resources/ 或 desktop/，托盘图标固定是 tray.ico。

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { createShellTheme } = require("../lib/shell-theme");
const { resolveTrayIconPath } = require("../lib/tray-menu");

/** 假 nativeTheme：可改 shouldUseDarkColors，并能触发 updated 订阅。 */
function fakeNativeTheme(dark) {
  const listeners = new Set();
  const theme = {
    shouldUseDarkColors: dark,
    on(event, handler) {
      if (event === "updated") listeners.add(handler);
    },
    emitUpdated() {
      for (const handler of listeners) handler();
    },
    setDark(value) {
      theme.shouldUseDarkColors = value;
      theme.emitUpdated();
    },
  };
  return theme;
}

function makeTheme({ systemDark = false, packaged = false } = {}) {
  const nativeTheme = fakeNativeTheme(systemDark);
  const shellTheme = createShellTheme({
    nativeTheme,
    app: { isPackaged: packaged },
    dirname: "D:/apps/desktop",
    resourcesPath: () => "D:/apps/resources",
    logLine: () => {},
  });
  return { nativeTheme, shellTheme };
}

test("splash 首帧只看系统主题（此时还没有应用内主题）", () => {
  const light = makeTheme({ systemDark: false });
  assert.equal(light.shellTheme.splashTheme(), "light");
  const dark = makeTheme({ systemDark: true });
  assert.equal(dark.shellTheme.splashTheme(), "dark");
});

test("托盘图标固定：主题与兜底开关都不再换图，托盘相关 API 已删除", () => {
  const { shellTheme, nativeTheme } = makeTheme({ systemDark: false });
  // 2026-11-20 决定：永远只用浅色那一枚（浅色任务栏下对比低也接受）。
  // 换图链路（trayIsDark → applyTray → tray.setTheme → iconFor）整体删除，
  // 断言这些入口不存在，防止有人照着旧注释加回来。
  for (const name of ["attachTray", "trayIsDark", "applyTray", "trayIconPath"]) {
    assert.equal(shellTheme[name], undefined, `${name} 必须已删除`);
  }
  // 主题上报与兜底开关仍然要能接收（IPC 会推），只是不再影响图标。
  assert.doesNotThrow(() => shellTheme.setAppTheme("dark"));
  assert.doesNotThrow(() => shellTheme.setFollowSystem(true));
  assert.equal(shellTheme.isFollowingSystem(), true);
  nativeTheme.setDark(true);
  assert.doesNotThrow(() => shellTheme.onNativeThemeUpdated());
  assert.doesNotThrow(() => shellTheme.setAppTheme("light"));
  assert.doesNotThrow(() => shellTheme.setFollowSystem(false));
  assert.equal(shellTheme.isFollowingSystem(), false);
});

test("nativeTheme.on(\"updated\") 仍被订阅（应用内主题跟随系统的触发点）", () => {
  const { nativeTheme, shellTheme } = makeTheme({ systemDark: false });
  shellTheme.setFollowSystem(true);
  // 订阅存在 = 系统切换会走到 onNativeThemeUpdated；不抛错即可（托盘已不参与）。
  assert.doesNotThrow(() => nativeTheme.setDark(true));
  assert.doesNotThrow(() => nativeTheme.setDark(false));
});

test("托盘尚未创建 / 缺少 nativeTheme 时切换主题不报错（启动早期）", () => {
  const { shellTheme } = makeTheme({ systemDark: true });
  assert.doesNotThrow(() => shellTheme.setAppTheme("light"));
  assert.doesNotThrow(() => shellTheme.setFollowSystem(true));
  const bare = createShellTheme({ app: { isPackaged: false }, dirname: "D:/apps/desktop" });
  assert.equal(bare.splashTheme(), "light");
  assert.doesNotThrow(() => bare.onNativeThemeUpdated());
});

test("图标路径：窗口图标读 resources/ 或 desktop/，托盘固定 tray.ico", () => {
  const packaged = makeTheme({ packaged: true });
  assert.equal(packaged.shellTheme.windowIconPath(), path.join("D:/apps/resources", "icon.png"));
  assert.equal(
    resolveTrayIconPath({ app: { isPackaged: true }, dirname: "D:/apps/desktop", resourcesPath: () => "D:/apps/resources" }),
    path.join("D:/apps/resources", "tray.ico"),
  );

  const dev = makeTheme({ packaged: false });
  assert.equal(dev.shellTheme.windowIconPath(), path.join("D:/apps/desktop", "icon.png"));
  assert.equal(
    resolveTrayIconPath({ app: { isPackaged: false }, dirname: "D:/apps/desktop" }),
    path.join("D:/apps/desktop", "tray.ico"),
  );
});
