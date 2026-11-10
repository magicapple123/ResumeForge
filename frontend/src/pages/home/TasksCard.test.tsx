// SPDX-License-Identifier: Apache-2.0
/**
 * 首页「任务」卡（T02/T04）：开关 gate、渲染、3 条上限、已结束折叠、D5 空任务过滤。
 *
 * 两个「开关 gate」与「空任务过滤」是本批新增的守卫点（T08 要求有反证）：
 * 关掉总开关时**不请求任务列表、也不渲染卡片**；空壳任务既不显示也不计入计数。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, AgentTaskStatus, AgentTaskStepStatus } from "../../api/agentTasks";
import { t } from "../../i18n";
import { TasksCard } from "./TasksCard";

const settingsMocks = vi.hoisted(() => ({ getAgentTaskEvents: vi.fn() }));
vi.mock("../../api/settings", () => settingsMocks);

const taskApiMocks = vi.hoisted(() => ({ listAgentTasks: vi.fn() }));
vi.mock("../../api/agentTasks", () => taskApiMocks);

const STEP_TITLES = ["Collect requirements", "Rewrite resume", "Export PDF"];

function makeTask(
  id: number,
  status: AgentTaskStatus,
  overrides: Partial<AgentTask> = {},
): AgentTask {
  const completed = status === "done" ? 3 : status === "draft" ? 0 : 1;
  const steps = STEP_TITLES.map((title, stepIndex) => ({
    step_index: stepIndex,
    kind: "",
    title,
    status: (stepIndex < completed ? "done" : "pending") as AgentTaskStepStatus,
    input_digest: "",
    output_ref: null,
    attempt: 0,
    error: "",
    started_at: null,
    finished_at: null,
  }));
  if (status === "waiting_approval") steps[completed].status = "waiting_approval";
  return {
    id,
    conversation_id: null,
    title: `Task ${id}`,
    goal: "",
    status,
    resume_cursor: completed,
    source: "manual",
    created_at: "2026-11-07T05:00:00",
    updated_at: "2026-11-07T05:00:00",
    finished_at: null,
    error: "",
    steps,
    ...overrides,
  };
}

/** 空壳任务（D5）：steps 为 0 且状态是 draft / cancelled。 */
function makeEmptyTask(id: number, status: AgentTaskStatus): AgentTask {
  return makeTask(id, status, { steps: [], resume_cursor: 0 });
}

function renderCard() {
  return render(
    <AntdApp>
      <TasksCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  settingsMocks.getAgentTaskEvents.mockReset().mockResolvedValue({ enabled: true });
  taskApiMocks.listAgentTasks.mockReset().mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("TasksCard", () => {
  it("开关开启且有任务时渲染标题、副标题与任务行", async () => {
    taskApiMocks.listAgentTasks.mockResolvedValue([makeTask(1, "running")]);
    renderCard();

    expect(await screen.findByText(t("tasksCard.title"))).toBeTruthy();
    expect(screen.getByText(t("tasksCard.subtitle"))).toBeTruthy();
    expect(await screen.findByTestId("agent-task-1")).toBeTruthy();
    // 首页任务卡不按会话过滤：取当前数据集全部任务（T02）。
    expect(taskApiMocks.listAgentTasks).toHaveBeenCalledWith(undefined);
  });

  it("卡片带 home-tasks-card 类（12.1 标题栏留白规则的落点）", async () => {
    taskApiMocks.listAgentTasks.mockResolvedValue([makeTask(1, "running")]);
    renderCard();

    const title = await screen.findByText(t("tasksCard.title"));
    const card = title.closest(".ant-card");
    expect(card).not.toBeNull();
    expect(card?.classList.contains("home-tasks-card")).toBe(true);
  });

  it("总开关关闭：不请求任务列表、整卡不渲染（T04 gate）", async () => {
    settingsMocks.getAgentTaskEvents.mockResolvedValue({ enabled: false });
    renderCard();

    // 等开关请求落地后再断言（用警告文案那条不会出现来做同步点不靠谱，直接等微任务）。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(taskApiMocks.listAgentTasks).not.toHaveBeenCalled();
    expect(screen.queryByText(t("tasksCard.title"))).toBeNull();
  });

  it("读不到开关时按关闭处理：不渲染、不请求", async () => {
    settingsMocks.getAgentTaskEvents.mockRejectedValue(new Error("boom"));
    renderCard();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(taskApiMocks.listAgentTasks).not.toHaveBeenCalled();
    expect(screen.queryByText(t("tasksCard.title"))).toBeNull();
  });

  it("只有空壳任务时整卡不渲染（D5）", async () => {
    taskApiMocks.listAgentTasks.mockResolvedValue([
      makeEmptyTask(1, "draft"),
      makeEmptyTask(2, "cancelled"),
    ]);
    renderCard();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(t("tasksCard.title"))).toBeNull();
  });

  it("空壳任务不显示也不计入上限（D5）", async () => {
    taskApiMocks.listAgentTasks.mockResolvedValue([
      makeEmptyTask(9, "draft"),
      makeEmptyTask(10, "cancelled"),
      makeTask(1, "running"),
    ]);
    renderCard();

    expect(await screen.findByTestId("agent-task-1")).toBeTruthy();
    expect(screen.queryByTestId("agent-task-9")).toBeNull();
    expect(screen.queryByTestId("agent-task-10")).toBeNull();
    // 过滤后只剩 1 条未结束任务，不该出现「还有 N 条」。
    expect(screen.queryByRole("button", { name: t("tasksCard.more", { count: 2 }) })).toBeNull();
  });

  it("未结束任务合计最多 3 条，超出收成「还有 N 条」（D2）", async () => {
    taskApiMocks.listAgentTasks.mockResolvedValue([
      makeTask(1, "waiting_approval"),
      makeTask(2, "running"),
      makeTask(3, "running"),
      makeTask(4, "running"),
      makeTask(5, "running"),
    ]);
    renderCard();

    expect(await screen.findByTestId("agent-task-1")).toBeTruthy();
    expect(screen.getByTestId("agent-task-3")).toBeTruthy();
    expect(screen.queryByTestId("agent-task-4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("tasksCard.more", { count: 2 }) }));
    expect(screen.getByTestId("agent-task-4")).toBeTruthy();
    expect(screen.getByTestId("agent-task-5")).toBeTruthy();
  });

  it("已结束(N) 默认收起，展开能看到最近的（D3/D4 不记忆）", async () => {
    taskApiMocks.listAgentTasks.mockResolvedValue([makeTask(1, "running"), makeTask(2, "done")]);
    renderCard();

    expect(await screen.findByTestId("agent-task-1")).toBeTruthy();
    expect(screen.queryByTestId("agent-task-2")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("tasksCard.finishedCount", { count: 1 }) }),
    );
    expect(screen.getByTestId("agent-task-2")).toBeTruthy();
  });
});
