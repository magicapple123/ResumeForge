// SPDX-License-Identifier: Apache-2.0
/**
 * 通知中心入口（页头铃铛，CR-25）。
 *
 * 四条必须成立的行为——它们对应任务书 §CR-25 的验收：
 * 1. 未读数与铃铛角标一致；
 * 2. 点开能看到列表（提醒与后台任务两类条目都在）；
 * 3. 点条目 → 标记这条已读 + 跳到 ``deep_link``（并把角标减一）；
 * 4. 「全部已读」→ 角标归零，空态说「都处理完了」。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationBell from "./NotificationBell";
import { resetBadgeParts } from "../../utils/desktopBadge";
import { t } from "../../i18n";
import type { AppNotification } from "../../api/notifications";

const api = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  unreadNotificationCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  recordNotification: vi.fn(),
}));

vi.mock("../../api/notifications", () => api);

function row(overrides: Partial<AppNotification>): AppNotification {
  return {
    id: 1,
    type: "reminder_due",
    severity: "info",
    title: "Reminder: application deadline",
    body: "Assessment deadline · Example Co · today",
    deep_link: "/tracker?reminder=1",
    read_at: null,
    created_at: new Date().toISOString(),
    expires_at: null,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderBell() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/"]}>
        <NotificationBell />
        <LocationProbe />
      </MemoryRouter>
    </AntdApp>,
  );
}

beforeEach(() => {
  resetBadgeParts();
  api.listNotifications.mockResolvedValue([]);
  api.unreadNotificationCount.mockResolvedValue({ unread: 0 });
  api.markNotificationRead.mockResolvedValue(row({ read_at: new Date().toISOString() }));
  api.markAllNotificationsRead.mockResolvedValue({ updated: 0 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationBell", () => {
  it("未读数与角标一致：有 2 条未读就显示 2", async () => {
    api.unreadNotificationCount.mockResolvedValue({ unread: 2 });
    renderBell();
    const bell = await screen.findByRole("button", { name: t("notifications.bell.aria") });
    // 角标由 antd Badge 包在按钮外层：读外层文本，不依赖 antd 内部类名。
    const wrapper = bell.closest(".ant-badge") ?? bell.parentElement;
    await waitFor(() => {
      expect(wrapper?.textContent).toContain("2");
    });
  });

  it("桌面壳角标跟着未读走：桥被调用成 2，全部已读后归零", async () => {
    // CR-24：`notify:set-badge` 是任务栏/托盘角标的唯一入口，界面里的角标与它是同一份数字。
    const setBadge = vi.fn();
    (window as { resumeForge?: { setBadge: (n: number) => void } }).resumeForge = { setBadge };
    api.unreadNotificationCount.mockResolvedValue({ unread: 2 });
    api.markAllNotificationsRead.mockResolvedValue({ updated: 2 });

    renderBell();
    await waitFor(() => expect(setBadge).toHaveBeenLastCalledWith(2));

    fireEvent.click(await screen.findByRole("button", { name: t("notifications.bell.aria") }));
    // 全部已读后服务端未读变 0；组件先 refreshUnread() 再推一次角标。
    api.unreadNotificationCount.mockResolvedValue({ unread: 0 });
    fireEvent.click(await screen.findByRole("button", { name: t("notifications.action.readAll") }));
    await waitFor(() => expect(setBadge).toHaveBeenLastCalledWith(0));

    delete (window as { resumeForge?: unknown }).resumeForge;
  });

  it("点开列表：提醒与后台任务两类条目都在", async () => {
    api.unreadNotificationCount.mockResolvedValue({ unread: 2 });
    api.listNotifications.mockResolvedValue([
      row({ id: 1, title: "Reminder: application deadline" }),
      row({
        id: 2,
        type: "background_task",
        title: "Apply batch finished",
        body: "8 succeeded · 0 failed",
        deep_link: "/apply",
      }),
    ]);
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: t("notifications.bell.aria") }));

    expect(await screen.findByText("Reminder: application deadline")).toBeInTheDocument();
    expect(screen.getByText("Apply batch finished")).toBeInTheDocument();
    // 分组：今天的条目在「今天」标题下（更早分组只在有更早条目时出现）。
    expect(screen.getByText(t("notifications.group.today"))).toBeInTheDocument();
  });

  it("点条目：标记这条已读并跳到 deep_link，角标减一", async () => {
    api.unreadNotificationCount.mockResolvedValueOnce({ unread: 1 });
    api.unreadNotificationCount.mockResolvedValue({ unread: 0 });
    api.listNotifications.mockResolvedValue([row({ id: 7 })]);
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: t("notifications.bell.aria") }));

    fireEvent.click(await screen.findByText("Reminder: application deadline"));
    await waitFor(() => {
      expect(api.markNotificationRead).toHaveBeenCalledWith(7);
    });
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/tracker?reminder=1");
    });
    // 标记后重新拉未读数：服务端已是 0，角标不该继续亮着。
    await waitFor(() => {
      expect(api.unreadNotificationCount.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      const host = document.querySelector(".notification-bell-button");
      expect(host?.closest(".ant-badge")?.textContent ?? "").not.toContain("1");
    });
  });

  it("全部已读：角标归零，列表变成「都处理完了」", async () => {
    api.unreadNotificationCount.mockResolvedValue({ unread: 3 });
    api.listNotifications.mockResolvedValue([
      row({ id: 1 }),
      row({ id: 2, title: "Second notice" }),
    ]);
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: t("notifications.bell.aria") }));
    expect(await screen.findByText("Second notice")).toBeInTheDocument();

    // 全部已读后：列表为空、未读为 0（服务端真实返回），面板原地刷新成空态。
    api.listNotifications.mockResolvedValue([]);
    api.unreadNotificationCount.mockResolvedValue({ unread: 0 });
    fireEvent.click(await screen.findByRole("button", { name: t("notifications.action.readAll") }));

    await waitFor(() => {
      expect(api.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(t("notifications.empty"))).toBeInTheDocument();
  });
});
