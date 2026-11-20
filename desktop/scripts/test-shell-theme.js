// SPDX-License-Identifier: Apache-2.0
"use strict";

// lib/shell-theme.js 的离线用例（WF-20）。
//
// 验收要求覆盖"应用内浅/深 × 系统浅/深"四种组合与兜底开关的开/关——这四组组合在
// 真机上要靠改系统设置才能复现，所以这里把它们钉成纯逻辑断言，再用一张真机截图补
// "图标确实换过去了"的观感证据。

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { createShellTheme } = require("../lib/shell-theme");

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

/** 假托盘：只记录每次 setImage 换算后的"暗色与否"。 */
function fakeTray() {
  const calls = [];
  return {
    calls,
    setTheme(isDark) {
      calls.push(isDark);
    },
  };
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
  return { nativeTheme, shellTheme, tray: fakeTray() };
}

test("splash 首帧只看系统主题（此时还没有应用内主题）", () => {
  const light = makeTheme({ systemDark: false });
  assert.equal(light.shellTheme.splashTheme(), "light");
  const dark = makeTheme({ systemDark: true });
  assert.equal(dark.shellTheme.splashTheme(), "dark");
});

test("默认托盘跟应用内主题：应用内深色时用**浅色**图标", () => {
  // 契约 2026-11-20 反转：图标按**托盘底色的明暗**选，不按"应用主题叫 dark"。
  // 深色界面 → 深色任务栏 → 要浅色图；原来映射反了，暗色模式下托盘图标发闷（真机反馈）。
  const { shellTheme, tray, nativeTheme } = makeTheme({ systemDark: false });
  shellTheme.attachTray(tray);
  shellTheme.setAppTheme("dark");
  assert.deepEqual(tray.calls.at(-1), false, "应用内暗色 → 浅色托盘图标");
  assert.equal(shellTheme.isFollowingSystem(), false);
  assert.equal(nativeTheme.shouldUseDarkColors, false);
});

test("兜底开关打开后托盘忽略应用内主题，只跟系统", () => {
  const { shellTheme, tray, nativeTheme } = makeTheme({ systemDark: false });
  shellTheme.attachTray(tray);
  shellTheme.setAppTheme("dark");
  shellTheme.setFollowSystem(true);
  assert.equal(tray.calls.at(-1), true, "系统浅色 → 深色图标（即使应用内是暗色）");

  // 系统切换要立刻反映（这是开关存在的意义）。
  nativeTheme.setDark(true);
  assert.equal(tray.calls.at(-1), false, "系统深色 → 浅色图标");

  // 关掉开关 → 回到应用内主题（暗色 → 浅色图标）。
  shellTheme.setFollowSystem(false);
  assert.equal(shellTheme.isFollowingSystem(), false);
  assert.equal(tray.calls.at(-1), false);
});

test("四种组合的最终图标（应用内浅/深 × 系统浅/深）", () => {
  const cases = [
    // dark = "用深色图" = 底色是浅的
    { app: "light", system: false, follow: false, dark: true },
    { app: "dark", system: false, follow: false, dark: false },
    { app: "light", system: true, follow: false, dark: true },
    { app: "dark", system: true, follow: false, dark: false },
    { app: "light", system: false, follow: true, dark: true },
    { app: "dark", system: false, follow: true, dark: true },
    { app: "light", system: true, follow: true, dark: false },
    { app: "dark", system: true, follow: true, dark: false },
  ];
  for (const item of cases) {
    const { shellTheme, tray } = makeTheme({ systemDark: item.system });
    shellTheme.attachTray(tray);
    shellTheme.setAppTheme(item.app);
    shellTheme.setFollowSystem(item.follow);
    assert.equal(
      shellTheme.trayIsDark(),
      item.dark,
      `app=${item.app} system=${item.system ? "dark" : "light"} follow=${item.follow}`,
    );
  }
});

test("托盘尚未创建时切换主题不报错（启动早期）", () => {
  const { shellTheme } = makeTheme({ systemDark: true });
  assert.doesNotThrow(() => shellTheme.setAppTheme("light"));
  assert.doesNotThrow(() => shellTheme.setFollowSystem(true));
});

test("图标路径：打包态读 resources/，开发态读 desktop/", () => {
  const packaged = makeTheme({ packaged: true });
  assert.equal(
    packaged.shellTheme.trayIconPath(),
    path.join("D:/apps/resources", "tray-dark.ico"),
  );
  assert.equal(packaged.shellTheme.windowIconPath(), path.join("D:/apps/resources", "icon.png"));

  const dev = makeTheme({ packaged: false });
  assert.equal(dev.shellTheme.trayIconPath(), path.join("D:/apps/desktop", "tray-dark.ico"));
  assert.equal(dev.shellTheme.windowIconPath(), path.join("D:/apps/desktop", "icon.png"));
});
