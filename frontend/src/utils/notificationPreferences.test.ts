// SPDX-License-Identifier: Apache-2.0
/**
 * CR-29 通道闸门（任务完成 / 提示音 / 静默时段）：开关关掉后**判定真的变了**。
 *
 * 这条用例挡的是"设置页能勾、行为没变"——`interruptAllowed` 是完成提示的唯一入口
 * （`taskNotify` 与 `TaskCompletionNotifier` 都问它），所以断言在这里就等于断言通道。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationSettings } from "../api/notificationSettings";
import {
  applyNotificationSettings,
  failureInterruptAllowed,
  interruptAllowed,
  isQuietNow,
  soundAllowed,
} from "./notificationPreferences";

const BASE: NotificationSettings = {
  notify_reminder_due: true,
  notify_task_waiting: true,
  notify_task_done: false,
  notify_batch_done: false,
  notify_sound: true,
  notify_quiet_hours: false,
  quiet_start: "22:00",
  quiet_end: "08:00",
  quiet_active: false,
};

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("通知开关 → 通道判定", () => {
  it("出厂口径：任务/批次完成默认不打断，失败类仍打断", () => {
    applyNotificationSettings(BASE);

    expect(interruptAllowed("task")).toBe(false);
    expect(interruptAllowed("batch")).toBe(false);
    expect(soundAllowed()).toBe(true);
    expect(failureInterruptAllowed()).toBe(true);
  });

  it("打开「任务完成」后同一个事件立刻放行（不是只改开关外观）", () => {
    applyNotificationSettings(BASE);
    expect(interruptAllowed("task")).toBe(false);

    applyNotificationSettings({ ...BASE, notify_task_done: true });
    expect(interruptAllowed("task")).toBe(true);
    // 另一个口径不受影响：批次完成仍安静。
    expect(interruptAllowed("batch")).toBe(false);
  });

  it("关掉「提示音」后提醒照弹但不出声", () => {
    applyNotificationSettings({ ...BASE, notify_task_done: true, notify_sound: false });

    expect(interruptAllowed("task")).toBe(true);
    expect(soundAllowed()).toBe(false);
  });

  it("静默时段压住所有打断与声音，失败类也不例外", () => {
    applyNotificationSettings({
      ...BASE,
      notify_task_done: true,
      notify_batch_done: true,
      notify_quiet_hours: true,
      quiet_start: "00:00",
      quiet_end: "23:59",
    });

    expect(isQuietNow()).toBe(true);
    expect(interruptAllowed("task")).toBe(false);
    expect(interruptAllowed("batch")).toBe(false);
    expect(failureInterruptAllowed()).toBe(false);
    expect(soundAllowed()).toBe(false);
  });

  it("静默时段的跨午夜区间按本地时间判定", () => {
    applyNotificationSettings({ ...BASE, notify_quiet_hours: true });

    expect(isQuietNow(new Date(2026, 0, 1, 23, 30))).toBe(true);
    expect(isQuietNow(new Date(2026, 0, 1, 7, 59))).toBe(true);
    expect(isQuietNow(new Date(2026, 0, 1, 8, 0))).toBe(false);
    expect(isQuietNow(new Date(2026, 0, 1, 12, 0))).toBe(false);
  });
});
