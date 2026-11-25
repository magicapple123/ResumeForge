// SPDX-License-Identifier: Apache-2.0
/**
 * CR-29：页头两个数字**各自独立**——铃铛 = 未读，任务按钮 = 运行中 + 待确认。
 *
 * 验收要的是"未读 3 + 运行中 2 时显示 3 和 2，不是 5"。这条用例把两个组件同时渲染，
 * 分别读各自的 Badge 文本，专门挡"为了省一个接口把两个数合并"的实现。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackgroundTasksIndicator from "./BackgroundTasksIndicator";
import NotificationBell from "./NotificationBell";
import { resetBackgroundTasks } from "../../utils/backgroundTasks";
import type { AgentTask } from "../../api/agentTasks";

const notificationsApi = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  unreadNotificationCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  recordNotification: vi.fn(),
}));
vi.mock("../../api/notifications", () => notificationsApi);

const agentApi = vi.hoisted(() => ({ listAgentTasks: vi.fn() }));
vi.mock("../../api/agentTasks", () => agentApi);

vi.mock("../../hooks/useJobMatchBackgroundTasks", () => ({
  useJobMatchBackgroundTasks: () => [],
}));
vi.mock("../jobs/jobAnalysisStore", () => ({
  useRunningJobAnalyses: () => [],
  cancelJobAnalysis: vi.fn(),
}));

function agentTask(id: number, status: AgentTask["status"]): AgentTask {
  return {
    id,
    title: `任务 ${id}`,
    goal: "",
    status,
    source: "manual",
    resume_cursor: 0,
    created_at: "2026-11-25T00:00:00",
    updated_at: "2026-11-25T00:00:00",
    steps: [],
  } as unknown as AgentTask;
}

function badgeTextOf(label: string): string {
  const button = screen.getByRole("button", { name: label });
  const badge = button.closest(".ant-badge") ?? button.parentElement;
  return badge?.textContent ?? "";
}

function renderHeader() {
  return render(
    <AntdApp>
      <MemoryRouter>
        <NotificationBell />
        <BackgroundTasksIndicator />
      </MemoryRouter>
    </AntdApp>,
  );
}

beforeEach(() => {
  resetBackgroundTasks();
  notificationsApi.listNotifications.mockResolvedValue([]);
  notificationsApi.unreadNotificationCount.mockResolvedValue({ unread: 3 });
  agentApi.listAgentTasks.mockResolvedValue([
    agentTask(1, "waiting_approval"),
    agentTask(2, "waiting_approval"),
    agentTask(3, "done"),
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("页头角标两个口径", () => {
  it("未读 3 + 待确认 2 → 铃铛 3、任务按钮 2（不是 5）", async () => {
    renderHeader();

    await waitFor(() => expect(badgeTextOf("通知中心")).toContain("3"));
    await waitFor(() => expect(badgeTextOf("查看后台任务")).toContain("2"));
    expect(badgeTextOf("通知中心")).not.toBe("5");
    expect(badgeTextOf("查看后台任务")).not.toBe("5");
  });

  it("running + 待确认 才是任务按钮的数：running 1 + waiting 2 → 3", async () => {
    agentApi.listAgentTasks.mockResolvedValue([
      agentTask(1, "waiting_approval"),
      agentTask(2, "waiting_approval"),
      agentTask(3, "running"),
    ]);
    renderHeader();

    await waitFor(() => expect(badgeTextOf("查看后台任务")).toContain("3"));
    expect(badgeTextOf("通知中心")).toContain("3");
  });
});
