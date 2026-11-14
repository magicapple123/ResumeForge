// SPDX-License-Identifier: Apache-2.0
/**
 * main.js 的装配用例：关闭行为 + 标题栏 IPC 真的接上了（问题清单 §18/§19）。
 *
 * 与 test-close-behavior.js（纯 lib 单元）互补：这里把整个 main.js 放进 VM，
 * 断言"窗口 close 事件 → 找 lib/close-behavior"、"菜单「关闭窗口」→ window.close()
 * → 同一条 close handler"、"主题 / 窗口状态 IPC → titlebar 控制器"这几条接线。
 *
 * 反证价值（§19.8）：把菜单的 window.close 改成 destroy()，本文件的
 * "menu 关闭窗口走第 18 条 handler" 会立刻变红。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { flush, loadMain, waitForShellReady } = require("./lifecycle-harness");
const { t } = require("../lib/shell-locale");

const closeEvent = () => {
  const event = {
    prevented: 0,
    preventDefault() {
      this.prevented += 1;
    },
  };
  return event;
};

function memoryFile(loaded) {
  return path.join(loaded.userDataDir, "close-behavior.json");
}

function writeMemory(loaded, remembered) {
  fs.writeFileSync(memoryFile(loaded), JSON.stringify({ remembered }), "utf8");
}

function readMemory(loaded) {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(loaded), "utf8")).remembered;
  } catch {
    return null;
  }
}

function trayAskItem(loaded) {
  const template = loaded.menuHolder.menu.template;
  return template.find((item) => item.label === "关闭窗口时询问");
}

async function trusted(loaded, action) {
  const handler = loaded.events.ipcHandlers["desktop:menu-action"];
  assert.equal(typeof handler, "function", "main.js 必须注册 desktop:menu-action");
  const window = loaded.windowInstances[0];
  return handler({ sender: window.webContents }, { action });
}

test("普通 close：走 lib/close-behavior 弹二选一；选「退出应用」后 quitting 已置位", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    loaded.state.closeDialogResponse = 1; // 退出应用

    const event = closeEvent();
    window.handlers.close(event);
    assert.equal(event.prevented, 1, "close 必须先被拦住（否则窗口直接关掉）");
    await flush();
    assert.equal(loaded.events.closeDialogPrompts.length, 1);
    assert.equal(loaded.events.quitCalls.length, 1, "选退出必须 app.quit()");

    // quitting 已置位：同一窗口的下一次 close 直接放行（不会再弹第二个框）。
    const again = closeEvent();
    window.handlers.close(again);
    assert.equal(again.prevented, 0, "退出流程中的 close 必须放行（否则无限弹窗）");
    assert.equal(loaded.events.closeDialogPrompts.length, 1);
  } finally {
    loaded.cleanup();
  }
});

test("选择「最小化到托盘」：窗口 hide()，应用不退出、托盘菜单仍在", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    loaded.state.closeDialogResponse = 0;
    window.handlers.close(closeEvent());
    await flush();
    assert.equal(window.hidden, 1);
    assert.equal(loaded.events.quitCalls.length, 0);
    assert.ok(loaded.menuHolder.menu, "最小化后托盘菜单仍可用");
  } finally {
    loaded.cleanup();
  }
});

test("记住「最小化」：写 userData/close-behavior.json，下次 close 不再弹窗", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    loaded.state.closeDialogResponse = 0;
    loaded.state.closeDialogCheckbox = true;
    window.handlers.close(closeEvent());
    await flush();
    assert.equal(readMemory(loaded), "minimize");
    assert.equal(fs.existsSync(memoryFile(loaded)), true, "记忆文件必须在 userData 根");
    assert.equal(
      fs.existsSync(path.join(path.dirname(loaded.userDataDir), "backend")),
      false,
      "记忆绝不能写进仓库目录",
    );
    // 托盘「关闭窗口时询问」勾选态随记忆变化刷新（unchecked）。
    const ask = trayAskItem(loaded);
    assert.equal(ask.checked, false);
    const setCount = loaded.menuHolder.setCount;

    const next = closeEvent();
    window.handlers.close(next);
    await flush();
    assert.equal(loaded.events.closeDialogPrompts.length, 1, "已记住时不得再弹窗");
    assert.equal(next.prevented, 1);
    assert.equal(window.hidden, 2);
    assert.equal(loaded.menuHolder.setCount, setCount, "直接执行路径不该重建菜单");
  } finally {
    loaded.cleanup();
  }
});

test("记忆文件里是 quit：下次 close 直接退出、不弹窗", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    writeMemory(loaded, "quit");
    const window = loaded.windowInstances[0];
    window.handlers.close(closeEvent());
    await flush();
    assert.equal(loaded.events.closeDialogPrompts.length, 0);
    assert.equal(loaded.events.quitCalls.length, 1);
  } finally {
    loaded.cleanup();
  }
});

test("记忆文件损坏：当作未记住，恢复询问", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    fs.writeFileSync(memoryFile(loaded), "{broken", "utf8");
    const window = loaded.windowInstances[0];
    const event = closeEvent();
    window.handlers.close(event);
    await flush();
    assert.equal(event.prevented, 1);
    assert.equal(loaded.events.closeDialogPrompts.length, 1);
  } finally {
    loaded.cleanup();
  }
});

test("托盘「关闭窗口时询问」勾上：清掉记忆并重建菜单，再 close 恢复询问", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    // 先通过对话框勾「记住」写入记忆（真实写路径），托盘勾选态随之刷新。
    loaded.state.closeDialogResponse = 0;
    loaded.state.closeDialogCheckbox = true;
    window.handlers.close(closeEvent());
    await flush();
    assert.equal(readMemory(loaded), "minimize");
    assert.equal(loaded.events.closeDialogPrompts.length, 1);

    // 已记住 → 再次 close 直接隐藏，不弹窗。
    window.handlers.close(closeEvent());
    await flush();
    assert.equal(loaded.events.closeDialogPrompts.length, 1);

    const before = loaded.menuHolder.setCount;
    const ask = trayAskItem(loaded);
    assert.equal(ask.checked, false, "已记住时 checkbox 未勾选");
    ask.click({ checked: true });
    assert.equal(readMemory(loaded), null, "勾上 = 清掉记忆");
    assert.equal(loaded.menuHolder.setCount, before + 1, "清掉记忆后要重建菜单让勾选态回到真相");

    const promptsBefore = loaded.events.closeDialogPrompts.length;
    window.handlers.close(closeEvent());
    await flush();
    assert.equal(loaded.events.closeDialogPrompts.length, promptsBefore + 1,
      "记忆清掉后必须恢复询问");
  } finally {
    loaded.cleanup();
  }
});

test("菜单「关闭窗口」走 window.close() 与第 18 条 handler（不是 destroy()）", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    loaded.state.closeDialogResponse = 0;

    const result = await trusted(loaded, "window.close");
    assert.equal(result.ok, true);
    assert.equal(window.closeCalls, 1, "必须调用 window.close()");
    assert.equal(window.destroyCalls, 0, "绝不能直接 destroy()");
    assert.equal(window.destroyed, false, "close 被第 18 条拦住，窗口还在");
    await flush();
    assert.equal(loaded.events.closeDialogPrompts.length, 1,
      "菜单「关闭窗口」必须触发第 18 条的二选一对话框");

    // 对照：动作 id 白名单之外的东西一律拒绝。
    const bogus = await trusted(loaded, "window.destroy");
    assert.equal(bogus.ok, false);
  } finally {
    loaded.cleanup();
  }
});

test("IPC 只信主窗口：非主窗口 sender 的动作 / 主题都被拒绝", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const handler = loaded.events.ipcHandlers["desktop:menu-action"];
    const rejected = await handler({ sender: { rogue: true } }, { action: "edit.undo" });
    assert.equal(rejected.ok, false);
    assert.equal(loaded.events.sent.filter((item) => item.channel === "webContents.undo").length, 0);

    loaded.events.setThemeHandler({ sender: { rogue: true } }, "dark");
    assert.equal(loaded.events.themeCalls.length, 0);

    const stateHandler = loaded.events.ipcHandlers["desktop:get-window-state"];
    assert.deepEqual(await stateHandler({ sender: { rogue: true } }), {
      maximized: false,
      fullscreen: false,
      alwaysOnTop: false,
      editableFocus: false,
    });
  } finally {
    loaded.cleanup();
  }
});

test("菜单编辑动作经 IPC 落到 webContents；关于信息返回版本与外链", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    assert.equal((await trusted(loaded, "edit.undo")).ok, true);
    assert.equal(loaded.events.sent.some((item) => item.channel === "webContents.undo"), true);

    const info = await trusted(loaded, "about.getInfo");
    assert.equal(info.ok, true);
    assert.equal(info.result.version, loaded.appStub.getVersion());
    assert.match(info.result.website, /^https:\/\//);
    assert.match(info.result.license, /LICENSE$/);
  } finally {
    loaded.cleanup();
  }
});

test("窗口最大化 / 全屏变化会推 desktop:window-state 给渲染层", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    window.maximize();
    const states = loaded.events.sent.filter((item) => item.channel === "desktop:window-state");
    assert.ok(states.length >= 1, "maximize 后必须推送窗口状态");
    assert.equal(states[states.length - 1].payload.maximized, true);

    window.setFullScreen(true);
    const after = loaded.events.sent.filter((item) => item.channel === "desktop:window-state");
    assert.equal(after[after.length - 1].payload.fullscreen, true);

    const handler = loaded.events.ipcHandlers["desktop:get-window-state"];
    const state = await handler({ sender: window.webContents });
    assert.deepEqual(state, {
      maximized: true,
      fullscreen: true,
      // #34A：快照里带上置顶实态（测试桩没实现 isAlwaysOnTop，按 false 兜底）。
      alwaysOnTop: false,
      // #34F：可编辑焦点由渲染层上报，初始为 false。
      editableFocus: false,
    });
  } finally {
    loaded.cleanup();
  }
});

test("应用内语言 IPC：切到英文重建托盘菜单/tooltip 并兜底窗口标题，非法值与冒充发送方被忽略", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    // 启动时按系统语言兜底建一次菜单（harness 的 app.getLocale 默认 zh-CN）。
    assert.equal(loaded.menuHolder.setCount, 1);
    const zhQuit = t("zh", "tray.quit");
    assert.ok(loaded.menuHolder.menu.template.some((item) => item.label === zhQuit));

    const handler = loaded.events.setLocaleHandler;
    assert.equal(typeof handler, "function", "main.js 必须注册 desktop:set-locale");
    handler({ sender: window.webContents }, "en");

    assert.equal(loaded.menuHolder.setCount, 2, "语言切换必须重建托盘菜单");
    const labels = loaded.menuHolder.menu.template.map((item) => item.label);
    assert.ok(labels.includes(t("en", "tray.quit")), "菜单文案必须换成英文");
    assert.ok(!labels.includes(zhQuit), "不得残留旧语言菜单项");
    assert.equal(
      loaded.events.trayToolTips[loaded.events.trayToolTips.length - 1],
      "ResumeForge",
      "tooltip 必须与菜单同一次重建换掉",
    );
    assert.equal(loaded.events.windowTitles.pop(), "ResumeForge", "窗口标题要有兜底并换语言");

    // 同语言重复推送不重建（React 首帧 + 服务端校正各推一次是预期行为）。
    handler({ sender: window.webContents }, "en");
    assert.equal(loaded.menuHolder.setCount, 2);
    // 只接受 zh / en；其它值静默忽略。
    handler({ sender: window.webContents }, "fr");
    handler({ sender: window.webContents }, { locale: "en" });
    assert.equal(loaded.menuHolder.setCount, 2);
    // 非主窗口发来的一律拒绝（与 menu-action / set-theme 同一条发送方校验）。
    handler({ sender: { rogue: true } }, "zh");
    assert.equal(loaded.menuHolder.setCount, 2);
    assert.ok(loaded.menuHolder.menu.template.some((item) => item.label === t("en", "tray.quit")));
  } finally {
    loaded.cleanup();
  }
});

test("启动语言兜底：英文系统下托盘与 tooltip 一开始就是英文", async () => {
  const loaded = loadMain({ appLocale: "en-US" });
  try {
    await waitForShellReady(loaded);
    const labels = loaded.menuHolder.menu.template.map((item) => item.label);
    assert.ok(labels.includes("Quit"), "英文系统下托盘应是英文");
    assert.ok(!labels.some((label) => /[\u4e00-\u9fff]/.test(label)), "不得先闪一段中文");
    assert.equal(loaded.events.trayToolTips[0], "ResumeForge");
  } finally {
    loaded.cleanup();
  }
});

test("关闭卡片跟随应用内语言：切换后下一次打开带新的 ?locale=", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    loaded.state.closeDialogResponse = 0;

    window.handlers.close(closeEvent());
    await flush();
    const firstDialogs = loaded.windowInstances.filter((item) => item.isCloseDialog);
    assert.equal(firstDialogs.length, 1);
    assert.ok(firstDialogs[0].loadedURL.endsWith("?locale=zh"), firstDialogs[0].loadedURL);

    loaded.events.setLocaleHandler({ sender: window.webContents }, "en");
    window.handlers.close(closeEvent());
    await flush();
    const dialogs = loaded.windowInstances.filter((item) => item.isCloseDialog);
    assert.equal(dialogs.length, 2);
    assert.ok(
      dialogs[dialogs.length - 1].loadedURL.endsWith("?locale=en"),
      "已打开的卡片不热切换，但下一次打开必须是新语言",
    );
  } finally {
    loaded.cleanup();
  }
});

test("主题同步：主窗口发来的 setTheme 落到 titleBarOverlay（深色另一套颜色）", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    loaded.events.setThemeHandler({ sender: window.webContents }, "dark");
    assert.equal(loaded.events.themeCalls.length, 1);
    assert.equal(loaded.events.themeCalls[0].color, "#151b23");
    assert.equal(loaded.events.themeCalls[0].height, 32);
  } finally {
    loaded.cleanup();
  }
});
