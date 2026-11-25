// SPDX-License-Identifier: Apache-2.0
/**
 * CR-29「通知」分组：六个开关的默认值与即改即存。
 *
 * 三条口径：
 * 1. 默认值来自后端（决策类开、结果类关），前端不复制一份默认值；
 * 2. 点开关只 PUT 这一个键（部分更新，不会把别的开关一起覆盖）；
 * 3. 保存成功后把返回快照写回通道缓存——不用重启就生效。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsCard from "./NotificationsCard";
import { t } from "../../i18n";
import type { NotificationSettings } from "../../api/notificationSettings";
import { currentNotificationSettings } from "../../utils/notificationPreferences";

const api = vi.hoisted(() => ({
  getNotificationSettings: vi.fn(),
  saveNotificationSettings: vi.fn(),
}));

vi.mock("../../api/notificationSettings", () => api);

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

function renderCard() {
  return render(
    <AntdApp>
      <NotificationsCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  api.getNotificationSettings.mockResolvedValue(BASE);
  api.saveNotificationSettings.mockImplementation((patch: Partial<NotificationSettings>) =>
    Promise.resolve({ ...BASE, ...patch }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationsCard", () => {
  it("renders the six switches with the backend defaults", async () => {
    renderCard();

    const reminder = await screen.findByTestId("switch-notify_reminder_due");
    expect(reminder.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("switch-notify_task_waiting").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByTestId("switch-notify_task_done").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.getByTestId("switch-notify_batch_done").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.getByTestId("switch-notify_sound").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("switch-notify_quiet_hours").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("saves only the toggled key and applies the returned snapshot", async () => {
    renderCard();
    await screen.findByTestId("switch-notify_task_done");

    fireEvent.click(screen.getByTestId("switch-notify_task_done"));

    await waitFor(() => expect(api.saveNotificationSettings).toHaveBeenCalledTimes(1));
    expect(api.saveNotificationSettings).toHaveBeenCalledWith({ notify_task_done: true });
    await waitFor(() =>
      expect(screen.getByTestId("switch-notify_task_done").getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    expect(currentNotificationSettings()?.notify_task_done).toBe(true);
  });

  it("shows the quiet window in the hint instead of a time picker", async () => {
    api.getNotificationSettings.mockResolvedValue({
      ...BASE,
      notify_quiet_hours: true,
      quiet_start: "23:30",
      quiet_end: "07:15",
    });
    renderCard();

    expect(await screen.findByText(/23:30–07:15/)).toBeInTheDocument();
  });

  it("surfaces a load failure instead of rendering wrong defaults", async () => {
    api.getNotificationSettings.mockRejectedValue(new Error("boom"));
    renderCard();

    expect(await screen.findByText(t("notificationsSettings.loadFailed"))).toBeInTheDocument();
    // 读取失败时开关不可操作：避免用户对着"全关"的假状态点来点去。
    expect(await screen.findByTestId("switch-notify_task_done")).toHaveProperty("disabled", true);
  });
});
