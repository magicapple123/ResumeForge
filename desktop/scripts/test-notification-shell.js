// SPDX-License-Identifier: Apache-2.0
/**
 * main.js 的桌面通知通道集成用例（CR-24）：
 *  - 主窗口 webPreferences 关掉 backgroundThrottling（CR-23 的桌面半边）；
 *  - win32 下 setAppUserModelId 被调用一次；
 *  - 渲染层 notify:show → 主进程构造 silent Notification；点击恢复窗口并推 deep_link；
 *  - 聚焦且可见时不弹；isSupported=false 时返回 {shown:false}；
 *  - notify:set-badge → app.setBadgeCount + 托盘 tooltip 追加待办数。
 *
 * 系统通知在 CI/无桌面环境里无法截屏，本文件就是"主进程确实构造了通知"的证据。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadMain, waitForShellReady } = require("./lifecycle-harness");

const { APP_USER_MODEL_ID } = require("../lib/notification-channel");

test("主窗口关闭后台节流；win32 下 AUMID 只设一次", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    assert.equal(
      window.options.webPreferences.backgroundThrottling,
      false,
      "CR-23：隐藏窗口的定时器不能被 Chromium 压到 1 分钟",
    );
    assert.deepEqual(loaded.events.aumidCalls, [APP_USER_MODEL_ID]);
  } finally {
    loaded.cleanup();
  }
});

test("notify:show 构造 silent 通知；点击恢复/聚焦窗口并把 deep_link 推回渲染层", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const window = loaded.windowInstances[0];
    window.focused = false;
    window.visible = false;
    window.minimized = true;

    const handler = loaded.events.ipcHandlers["notify:show"];
    assert.equal(typeof handler, "function", "main.js 必须注册 notify:show");
    const result = handler(
      { sender: window.webContents },
      {
        title: "简历已生成",
        body: "为「前端开发」生成的简历已完成",
        deepLink: "/resumes?resume_id=42",
        dedupeKey: "background:resume_generate#7",
      },
    );

    assert.equal(result.shown, true);
    assert.equal(loaded.events.notifications.length, 1);
    const notification = loaded.events.notifications[0];
    assert.equal(notification.options.title, "简历已生成");
    assert.equal(notification.options.body, "为「前端开发」生成的简历已完成");
    assert.equal(notification.options.silent, true);
    assert.equal(notification.shown, 1);

    notification.handlers.click();
    assert.equal(window.restores ?? 0, 1, "最小化时点击通知必须 restore()");
    assert.ok(window.shows >= 1, "点击通知必须 show()");
    assert.ok(window.focuses >= 1, "点击通知必须 focus()");
    assert.ok(
      loaded.events.sent.some(
        (entry) => entry.channel === "notify:click" && entry.payload === "/resumes?resume_id=42",
      ),
      "deep_link 必须原样推回渲染层",
    );
  } finally {
    loaded.cleanup();
  }
});

test("聚焦且可见时不发；同 dedupeKey 60s 内只发一条", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    const handler = loaded.events.ipcHandlers["notify:show"];
    const payload = { title: "已完成", body: "x", dedupeKey: "same" };

    assert.deepEqual(handler({}, payload), { shown: false, reason: "focused" });
    assert.equal(loaded.events.notifications.length, 0);

    const window = loaded.windowInstances[0];
    window.focused = false;
    window.visible = false;
    assert.equal(handler({}, payload).shown, true);
    assert.deepEqual(handler({}, payload), { shown: false, reason: "throttled" });
    assert.equal(loaded.events.notifications.length, 1);
  } finally {
    loaded.cleanup();
  }
});

test("isSupported=false 时回落应用内（返回 shown:false，不构造通知）", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);
    loaded.state.notificationSupported = false;
    const window = loaded.windowInstances[0];
    window.focused = false;
    window.visible = false;

    const result = loaded.events.ipcHandlers["notify:show"]({}, { title: "x", body: "y" });
    assert.equal(result.shown, false);
    assert.equal(result.reason, "unsupported");
    assert.equal(loaded.events.notifications.length, 0);
  } finally {
    loaded.cleanup();
  }
});

test("notify:set-badge 同步 app.setBadgeCount 与托盘 tooltip 待办数", async () => {
  const loaded = loadMain();
  try {
    await waitForShellReady(loaded);

    const handler = loaded.events.ipcHandlers["notify:set-badge"];
    assert.equal(typeof handler, "function", "main.js 必须注册 notify:set-badge");
    assert.equal(handler({}, 3), true);
    assert.deepEqual(loaded.events.badgeCalls, [3]);
    assert.match(
      loaded.events.trayToolTips[loaded.events.trayToolTips.length - 1],
      /3 条待办/,
      "Windows 上真正看得见的是托盘 tooltip",
    );

    handler({}, 0);
    assert.deepEqual(loaded.events.badgeCalls, [3, 0]);
    assert.ok(!/条待办/.test(loaded.events.trayToolTips[loaded.events.trayToolTips.length - 1]));
  } finally {
    loaded.cleanup();
  }
});
