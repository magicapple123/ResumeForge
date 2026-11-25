// SPDX-License-Identifier: Apache-2.0
/**
 * CR-29 通道闸门（批次完成）：开关只控制"打断"，不控制"记录"。
 *
 * 三条：
 * 1. 「批次完成」关着 → 不弹桌面通知、不出声，但 inbox 仍写一条（回看得到）；
 * 2. 打开 → 桌面通知照发；
 * 3. 静默时段 → 即使用户打开了也压住打断，inbox 仍写。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskCompletionNotifier from "./TaskCompletionNotifier";
import type { FinishedTaskEvent } from "../../hooks/useTaskCompletionWatcher";
import { applyNotificationSettings } from "../../utils/notificationPreferences";
import type { NotificationSettings } from "../../api/notificationSettings";

const api = vi.hoisted(() => ({ recordNotification: vi.fn() }));
vi.mock("../../api/notifications", () => api);

const notify = vi.hoisted(() => ({
  fire: vi.fn(),
  sound: vi.fn(),
  build: vi.fn(),
}));
vi.mock("../../utils/taskNotification", () => ({
  fireWebNotification: notify.fire,
  buildTaskNotification: notify.build,
}));
vi.mock("../../utils/notifySound", async () => {
  const actual =
    await vi.importActual<typeof import("../../utils/notifySound")>("../../utils/notifySound");
  return { ...actual, playDoneSound: notify.sound };
});

const watcher = vi.hoisted(() => ({
  callback: null as null | ((event: FinishedTaskEvent) => void),
}));
vi.mock("../../hooks/useTaskCompletionWatcher", () => ({
  useTaskCompletionWatcher: (callback: (event: FinishedTaskEvent) => void) => {
    watcher.callback = callback;
  },
}));

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

function finished(status = "completed"): FinishedTaskEvent {
  return {
    detail: {
      id: 9,
      kind: "apply",
      status,
      succeeded: 3,
      failed: 0,
      skipped: 0,
      message: "",
      items: [],
    },
  } as unknown as FinishedTaskEvent;
}

function renderNotifier() {
  render(
    <AntdApp>
      <MemoryRouter>
        <TaskCompletionNotifier />
      </MemoryRouter>
    </AntdApp>,
  );
}

beforeEach(() => {
  api.recordNotification.mockResolvedValue({ id: 1 });
  notify.build.mockReturnValue({ type: "success", message: "批次完成", description: "3 成功" });
  watcher.callback = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("批次完成的通道闸门", () => {
  it("关着开关：不弹桌面通知、不出声，但仍写 inbox", async () => {
    applyNotificationSettings(BASE);
    renderNotifier();
    await waitFor(() => expect(watcher.callback).not.toBeNull());

    watcher.callback?.(finished());

    expect(notify.fire).not.toHaveBeenCalled();
    expect(notify.sound).not.toHaveBeenCalled();
    await waitFor(() => expect(api.recordNotification).toHaveBeenCalledTimes(1));
  });

  it("打开开关：桌面通知与提示音都出现", async () => {
    applyNotificationSettings({ ...BASE, notify_batch_done: true });
    renderNotifier();
    await waitFor(() => expect(watcher.callback).not.toBeNull());

    watcher.callback?.(finished());

    expect(notify.fire).toHaveBeenCalledTimes(1);
    expect(notify.sound).toHaveBeenCalledTimes(1);
  });

  it("静默时段压住打断，但 inbox 照常记录", async () => {
    // 用一个"几乎整天"的窗口，避免依赖测试运行时刻（不注入假时钟，避免 waitFor 卡住）。
    applyNotificationSettings({
      ...BASE,
      notify_batch_done: true,
      notify_quiet_hours: true,
      quiet_start: "00:00",
      quiet_end: "23:59",
    });
    renderNotifier();
    await waitFor(() => expect(watcher.callback).not.toBeNull());

    watcher.callback?.(finished());

    expect(notify.fire).not.toHaveBeenCalled();
    expect(notify.sound).not.toHaveBeenCalled();
    await waitFor(() => expect(api.recordNotification).toHaveBeenCalledTimes(1));
  });

  it("失败批次按决策类放行（默认安静不压失败）", async () => {
    applyNotificationSettings(BASE);
    renderNotifier();
    await waitFor(() => expect(watcher.callback).not.toBeNull());

    watcher.callback?.(finished("failed"));

    expect(notify.fire).toHaveBeenCalledTimes(1);
  });
});
