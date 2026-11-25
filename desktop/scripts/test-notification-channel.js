// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面系统通知通道的离线用例（CR-24）。
 *
 * 覆盖：AUMID 只设一次、silent 系统通知、点击回到应用并推 deep_link、
 * 聚焦且可见时不发、同 dedupeKey 60s 节流、isSupported=false 回落、角标与托盘 tooltip。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createNotificationChannel, APP_USER_MODEL_ID } = require("../lib/notification-channel");

function harness(overrides = {}) {
  const events = {
    aumid: [],
    badges: [],
    notifications: [],
    sent: [],
    trayCounts: [],
    log: [],
  };
  const app = {
    setAppUserModelId(id) {
      events.aumid.push(id);
    },
    setBadgeCount(count) {
      events.badges.push(count);
      return true;
    },
  };
  class FakeNotification {
    static isSupported() {
      return overrides.supported !== false;
    }
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.shown = 0;
      events.notifications.push(this);
    }
    on(name, handler) {
      this.handlers[name] = handler;
    }
    show() {
      this.shown += 1;
    }
  }
  const ipcHandlers = {};
  const ipcMain = {
    handle(name, handler) {
      ipcHandlers[name] = handler;
    },
  };
  const window = {
    focused: true,
    visible: true,
    minimized: false,
    shows: 0,
    focuses: 0,
    restores: 0,
    isDestroyed: () => false,
    isFocused() {
      return this.focused;
    },
    isVisible() {
      return this.visible;
    },
    isMinimized() {
      return this.minimized;
    },
    show() {
      this.shows += 1;
      this.visible = true;
    },
    focus() {
      this.focuses += 1;
    },
    restore() {
      this.restores += 1;
      this.minimized = false;
    },
    webContents: {
      send(channel, payload) {
        events.sent.push({ channel, payload });
      },
    },
  };
  const tray = {
    setPendingCount(count) {
      events.trayCounts.push(count);
    },
  };
  let clock = 1_000;
  const channel = createNotificationChannel({
    app,
    Notification: FakeNotification,
    ipcMain,
    getWindow: () => window,
    getTrayManager: () => tray,
    platform: overrides.platform ?? "win32",
    now: () => clock,
    logLine: (line) => events.log.push(line),
  });
  return {
    channel,
    events,
    window,
    ipcHandlers,
    advance(ms) {
      clock += ms;
    },
  };
}

test("win32 下设置 AUMID，且只设一次；非 win32 不设", () => {
  const { events } = harness();
  assert.deepEqual(events.aumid, [APP_USER_MODEL_ID]);
  assert.equal(APP_USER_MODEL_ID, "top.huangcenguo.resumeforge", "必须与 electron-builder.yml 的 appId 一致");

  const mac = harness({ platform: "darwin" });
  assert.deepEqual(mac.events.aumid, [], "macOS 不走 Windows AUMID");
});

test("窗口不在前台时构造 silent 系统通知；点击恢复窗口并把 deep_link 推回渲染层", () => {
  const { channel, events, window } = harness();
  window.focused = false;
  window.visible = false;
  window.minimized = true;

  const result = channel.show({
    title: "简历已生成",
    body: "为「前端开发」生成的简历已完成",
    deepLink: "/resumes?resume_id=42",
    dedupeKey: "background:resume_generate#7",
  });

  assert.equal(result.shown, true);
  assert.equal(events.notifications.length, 1);
  const notification = events.notifications[0];
  assert.equal(notification.options.title, "简历已生成");
  assert.equal(notification.options.body, "为「前端开发」生成的简历已完成");
  assert.equal(notification.options.silent, true, "提示音统一由渲染层 WebAudio 出，系统通知静音");
  assert.equal(notification.shown, 1);

  notification.handlers.click();
  assert.equal(window.restores, 1, "最小化时必须 restore()，否则窗口仍不可见");
  assert.equal(window.shows, 1);
  assert.equal(window.focuses, 1);
  assert.deepEqual(events.sent, [{ channel: "notify:click", payload: "/resumes?resume_id=42" }]);
});

test("窗口聚焦且可见时不发系统通知（应用内 toast 已足够）", () => {
  const { channel, events, window } = harness();
  window.focused = true;
  window.visible = true;

  const result = channel.show({ title: "已完成", body: "不该弹" });

  assert.deepEqual(result, { shown: false, reason: "focused" });
  assert.equal(events.notifications.length, 0);
});

test("同 dedupeKey 60 秒内只发一条，超时后可以再发", () => {
  const { channel, events, window, advance } = harness();
  window.focused = false;
  window.visible = false;
  const payload = { title: "已完成", body: "x", dedupeKey: "same-key" };

  assert.equal(channel.show(payload).shown, true);
  advance(59_999);
  assert.deepEqual(channel.show(payload), { shown: false, reason: "throttled" });
  assert.equal(events.notifications.length, 1);

  advance(1);
  assert.equal(channel.show(payload).shown, true);
  assert.equal(events.notifications.length, 2);

  // 没有 dedupeKey 就不节流：两条不同的通知不该互相吃掉。
  assert.equal(channel.show({ title: "a", body: "" }).shown, true);
  assert.equal(channel.show({ title: "b", body: "" }).shown, true);
});

test("Notification.isSupported() 为 false 时回落应用内（返回 shown:false）", () => {
  const { channel, events, window } = harness({ supported: false });
  window.focused = false;
  window.visible = false;
  const result = channel.show({ title: "x", body: "y" });
  assert.equal(result.shown, false);
  assert.equal(result.reason, "unsupported");
  assert.equal(events.notifications.length, 0);
});

test("角标：调用 app.setBadgeCount 并同步托盘 tooltip 计数；0 也在同一条路上", () => {
  const { channel, events } = harness();
  assert.equal(channel.setBadge(3), true);
  assert.equal(channel.setBadge(0), true);
  assert.deepEqual(events.badges, [3, 0]);
  assert.deepEqual(events.trayCounts, [3, 0]);
});

test("install 注册 notify:show / notify:set-badge 两个固定通道", () => {
  const { channel, ipcHandlers, events, window } = harness();
  assert.equal(channel.install(), true);
  assert.equal(typeof ipcHandlers["notify:show"], "function");
  assert.equal(typeof ipcHandlers["notify:set-badge"], "function");

  // 窗口在后台：通道才真的弹系统通知（前台由应用内 toast 负责）。
  window.focused = false;
  window.visible = false;
  events.badges.length = 0;
  const shown = ipcHandlers["notify:show"]({ sender: {} }, { title: "T", body: "B" });
  assert.equal(shown.shown, true);
  ipcHandlers["notify:set-badge"]({ sender: {} }, 5);
  assert.deepEqual(events.badges, [5]);
});
