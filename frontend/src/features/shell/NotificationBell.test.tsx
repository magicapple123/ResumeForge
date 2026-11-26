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

/**
 * 铃铛的可访问名（整改 #14）：有未读时带条数，未读为 0 时退回固定串。
 * 用例按当前未读数取名字，避免在断言里写死中文（cjkRatchet 只降不升）。
 */
function bellName(unread: number): string {
  return unread > 0
    ? t("notifications.bell.ariaUnread", { count: unread })
    : t("notifications.bell.aria");
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
    const bell = await screen.findByRole("button", { name: bellName(2) });
    // 角标包在**铃铛图标**上（整改 #14：锚点从 32px 按钮移到图标），所以从按钮里找它。
    const wrapper = bell.querySelector(".rf-count-badge") ?? bell;
    await waitFor(() => {
      expect(wrapper.textContent).toContain("2");
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

    fireEvent.click(await screen.findByRole("button", { name: bellName(2) }));
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
    fireEvent.click(await screen.findByRole("button", { name: bellName(2) }));

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
    fireEvent.click(await screen.findByRole("button", { name: bellName(1) }));

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
      // 角标在按钮内部（锚点是图标），标记已读后它整块不渲染。
      const host = document.querySelector(".notification-bell-button");
      expect(host?.querySelector(".ant-badge-count")).toBeNull();
    });
  });

  it("全部已读：角标归零，列表变成「都处理完了」", async () => {
    api.unreadNotificationCount.mockResolvedValue({ unread: 3 });
    api.listNotifications.mockResolvedValue([
      row({ id: 1 }),
      row({ id: 2, title: "Second notice" }),
    ]);
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: bellName(3) }));
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

  /**
   * 整改 #13：条目行换成共用「事件行」——副行要有相对时间与正文，
   * 且 `deep_link` 为空时**只标已读、不关面板**（旧写法先关面板再判空，
   * 读起来就是"点了没反应"）。
   */
  it("副行显示「相对时间 · 正文」", async () => {
    api.listNotifications.mockResolvedValue([
      row({ id: 3, body: "Assessment deadline · today", created_at: new Date().toISOString() }),
    ]);
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: bellName(0) }));

    const title = await screen.findByText("Reminder: application deadline");
    const rowNode = title.closest(".rf-event-row");
    expect(rowNode).not.toBeNull();
    expect(rowNode?.querySelector(".rf-event-meta")).toHaveTextContent(
      "Assessment deadline · today",
    );
    // 相对时间在最前面（今天的事件写成「今天 HH:mm」）。
    expect(rowNode?.querySelector(".rf-event-meta")?.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("deep_link 为空：只标已读，不跳转、面板不关", async () => {
    api.listNotifications.mockResolvedValue([row({ id: 4, deep_link: "" })]);
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: bellName(0) }));

    fireEvent.click(await screen.findByText("Reminder: application deadline"));

    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith(4));
    expect(screen.getByTestId("location").textContent).toBe("/");
    // 面板仍在：还能看到「全部已读」这个面板内动作。
    expect(
      screen.getByRole("button", { name: t("notifications.action.readAll") }),
    ).toBeInTheDocument();
  });

  /**
   * 整改 #14：角标收紧 + 进无障碍名。
   *
   * 三条都是 jsdom 能判的：`aria-label` 带条数（角标对读屏完全不可见，这是顺带补的真缺陷）、
   * 未读为 0 时角标整块不渲染、以及**没有**退回 antd 的 `size="small"`（20px 量级实心圆；
   * 尺寸由 `count-badge.css` 的 14px 胶囊接管）。像素级位置由实机验收量。
   */
  it("未读条数进无障碍名：3 条未读时标签里带 3", async () => {
    api.unreadNotificationCount.mockResolvedValue({ unread: 3 });
    renderBell();

    const bell = await screen.findByRole("button", { name: bellName(3) });
    expect(bell.getAttribute("aria-label")).toContain("3");
  });

  it("未读为 0：标签不含数字，角标整块不渲染", async () => {
    renderBell();

    const bell = await screen.findByRole("button", { name: bellName(0) });
    expect(bell.getAttribute("aria-label")).not.toMatch(/\d/);
    await waitFor(() => expect(document.querySelector(".ant-badge-count")).toBeNull());
  });

  it("角标是共用组件的 14px 胶囊，不是 antd 的 small", async () => {
    api.unreadNotificationCount.mockResolvedValue({ unread: 3 });
    renderBell();

    await screen.findByRole("button", { name: bellName(3) });
    const count = await waitFor(() => {
      const node = document.querySelector(".rf-count-badge .ant-badge-count");
      if (!node) throw new Error("还没渲染角标");
      return node;
    });
    expect(count.textContent).toBe("3");
    // 反证对象：给 CountBadge 传 size="small" 会精确变红——页头又会同时有两种角标。
    expect(count.classList.contains("ant-badge-count-sm")).toBe(false);
    // 角标必须在按钮内部（锚点是铃铛图标），包在按钮外面就又"飘"了。
    expect(count.closest(".notification-bell-button")).not.toBeNull();
  });
});
