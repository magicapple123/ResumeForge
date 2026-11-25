// SPDX-License-Identifier: Apache-2.0
"use strict";

// lifecycle-harness.js 的 CR-24 部分（系统通知 / AUMID / 角标 / 窗口可见性）。
//
// 为什么单独成文件：desktop/**/*.js 全部受 500 行预算约束，harness 原本正好 500 行；
// 通知通道的桩对象单独放这里，harness 只保留一行装配。

/** app 上的 CR-24 方法（Windows toast 身份 + 角标）。 */
function installNotificationAppStubs(appStub, events) {
  appStub.setAppUserModelId = (id) => events.aumidCalls.push(id);
  appStub.setBadgeCount = (count) => {
    events.badgeCalls.push(count);
    return true;
  };
}

/** Notification 桩：不真的弹，只记录构造参数与点击回调。 */
function createNotificationStub({ events, state }) {
  return class NotificationStub {
    static isSupported() {
      return state.notificationSupported !== false;
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
  };
}

/**
 * 主窗口的显示/聚焦/最小化语义。
 *
 * 必须在 class 定义之后装到 prototype 上（覆盖原有空实现），否则通知通道读到的
 * isVisible()/isFocused() 永远是 false，"聚焦时不发"与"点击 restore()"都测不出来。
 */
function installNotificationWindowBehavior(BrowserWindowStub) {
  Object.assign(BrowserWindowStub.prototype, {
    show() { this.shows = (this.shows ?? 0) + 1; this.visible = true; },
    hide() { this.hidden = (this.hidden ?? 0) + 1; this.visible = false; },
    focus() { this.focuses = (this.focuses ?? 0) + 1; this.focused = true; },
    isVisible() { return this.visible !== false; },
    isFocused() { return this.focused !== false; },
    isMinimized() { return this.minimized === true; },
    restore() { this.restores = (this.restores ?? 0) + 1; this.minimized = false; this.visible = true; },
  });
}

module.exports = {
  createNotificationStub,
  installNotificationAppStubs,
  installNotificationWindowBehavior,
};
