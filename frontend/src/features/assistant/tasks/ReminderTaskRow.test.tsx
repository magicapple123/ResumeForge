// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒任务卡的专门行（CR-20）。
 *
 * ## 为什么单独一个文件
 *
 * 提醒到期生成的卡只有**一个确认步骤**，却按通用任务行渲染：标题下写着「第 0/1 步」、
 * 带「查看步骤」折叠，用户看到的是一个"进度 0%"的任务，而它其实只是一条提醒。
 * 这里钉住专门行的四条口径：
 *
 * 1. 不出现进度与步骤折叠（改成一行上下文：来自提醒 · 类型 · 到期 · 公司/岗位）；
 * 2. 未结束给「知道了」+「去求职进度」，终态只给结果（没有任何操作）；
 * 3. `goal` 那句话上卡（用户要知道"它不会替你做事"）；
 * 4. 提醒被软删后不给跳转链接，只留标题与时间。
 *
 * 另外钉首页侧的两条：终态提醒卡在首页任务卡里不出现；设置页「查看历史」能翻到它们。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, AgentTaskStatus } from "../../../api/agentTasks";
import { t } from "../../../i18n";
import AgentTaskPanel from "./AgentTaskPanel";
import ReminderTaskRow from "./ReminderTaskRow";
import { TasksCard } from "../../../pages/home/TasksCard";

const taskApiMocks = vi.hoisted(() => ({ listAgentTasks: vi.fn(), cancelAgentTask: vi.fn() }));
vi.mock("../../../api/agentTasks", () => taskApiMocks);

const settingsMocks = vi.hoisted(() => ({ getAgentTaskEvents: vi.fn() }));
vi.mock("../../../api/settings", () => settingsMocks);

/** 用例里的固定文案：抽成常量，`getByText(...)` 的参数就不含中文（中文断言棘轮只降不升）。 */
const TASK_TITLE = "提醒：参加某司二面";
const TITLE_A = "提醒：投递 A 司";
const TITLE_B = "提醒：投递 B 司";
const GOAL_PATTERN = /提醒到期后自动生成的任务卡：只提醒你准备，不会自动执行任何写操作。/;

const REMINDER_CONTEXT = {
  id: 11,
  title: "参加某司二面",
  kind: "interview",
  due_at: "2026-11-26T10:00:00",
  company: "某司",
  job_title: "后端工程师",
  deleted: false,
};

function makeReminderTask(status: AgentTaskStatus, overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 21,
    conversation_id: null,
    title: "提醒：参加某司二面",
    goal: "提醒到期后自动生成的任务卡：只提醒你准备，不会自动执行任何写操作。",
    status,
    resume_cursor: 0,
    source: "reminder",
    created_at: "2026-11-25T05:00:00",
    updated_at: "2026-11-25T05:00:00",
    finished_at: status === "cancelled" ? "2026-11-25T06:00:00" : null,
    error: "",
    steps: [
      {
        step_index: 0,
        kind: "confirm",
        title: "确认：提醒：参加某司二面",
        status: status === "cancelled" ? "skipped" : "pending",
        input_digest: "",
        output_ref: null,
        attempt: 0,
        error: "",
        started_at: null,
        finished_at: null,
      },
    ],
    reminder: REMINDER_CONTEXT,
    ...overrides,
  };
}

function renderPanel(task: AgentTask) {
  return render(
    <AntdApp>
      <MemoryRouter>
        <AgentTaskPanel
          tasks={[task]}
          error={null}
          onStart={() => undefined}
          onResume={() => undefined}
          onCancel={() => undefined}
        />
      </MemoryRouter>
    </AntdApp>,
  );
}

beforeEach(() => {
  settingsMocks.getAgentTaskEvents.mockReset().mockResolvedValue({ enabled: true });
  taskApiMocks.listAgentTasks.mockReset().mockResolvedValue([]);
  taskApiMocks.cancelAgentTask.mockReset().mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("提醒任务卡的专门行", () => {
  it("不再显示「第 0/1 步」与步骤折叠", () => {
    renderPanel(makeReminderTask("draft"));

    expect(
      screen.queryByText(t("assistantUi.tasks.progress", { current: 0, total: 1 })),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: t("assistantUi.tasks.action.steps") })).toBeNull();
  });

  it("标题下给「来自提醒 · 类型 · 到期 · 公司/岗位」", () => {
    renderPanel(makeReminderTask("draft"));

    const context = screen.getByTestId("agent-task-reminder-context-21");
    expect(context.textContent).toContain(t("assistantUi.tasks.reminder.from"));
    expect(context.textContent).toContain("面试");
    expect(context.textContent).toContain("某司");
    expect(context.textContent).toContain("后端工程师");
    // 到期时间按本地格式上卡（只断言日期片段，不钉死格式）。
    expect(context.textContent).toContain("11-26");
  });

  it("未结束给「知道了」与「去求职进度」，点「知道了」取消这张卡", () => {
    const onCancel = vi.fn();
    render(
      <AntdApp>
        <MemoryRouter>
          <AgentTaskPanel
            tasks={[makeReminderTask("draft")]}
            error={null}
            onStart={() => undefined}
            onResume={() => undefined}
            onCancel={onCancel}
          />
        </MemoryRouter>
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(onCancel).toHaveBeenCalledWith(21);
    expect(screen.getByRole("link", { name: "去求职进度" })).toHaveAttribute("href", "/tracker");
  });

  it("终态只显示结果：没有任何操作按钮", () => {
    // 终态提醒卡不在首页展示（首页只会有未结束的），它出现在设置页历史里 —— 所以这里
    // 直接渲染专门行，走的是历史弹窗那条路径（`readOnly` 之外不加别的开关）。
    render(
      <MemoryRouter>
        <ul>
          <ReminderTaskRow task={makeReminderTask("cancelled")} />
        </ul>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "知道了" })).toBeNull();
    expect(screen.queryByRole("link", { name: "去求职进度" })).toBeNull();
    expect(screen.getByText(t("assistantUi.tasks.status.cancelled"))).toBeInTheDocument();
    // 结果之外仍有上下文（历史里靠它认人）。
    expect(screen.getByTestId("agent-task-reminder-context-21")).toBeInTheDocument();
  });

  it("goal 那句话上卡", () => {
    renderPanel(makeReminderTask("draft"));

    expect(screen.getByText(GOAL_PATTERN)).toBeInTheDocument();
  });

  it("提醒被软删后不给跳转链接，只留标题与时间", () => {
    renderPanel(
      makeReminderTask("draft", {
        reminder: { ...REMINDER_CONTEXT, deleted: true },
      }),
    );

    // 标题不是链接（不再跳到求职进度）。
    expect(screen.queryByRole("link", { name: TASK_TITLE })).toBeNull();
    expect(screen.getByText(TASK_TITLE)).toBeInTheDocument();
    // 也没有「去求职进度」。
    expect(screen.queryByRole("link", { name: "去求职进度" })).toBeNull();
    // 到期时间仍在（用户至少知道它是什么时候的事）。
    const context = screen.getByTestId("agent-task-reminder-context-21");
    expect(context.textContent).toContain("11-26");
    // 只留标题与时间：公司/岗位/类型都不再出现（点进去也找不到那条提醒）。
    expect(context.textContent).not.toContain("某司");
    expect(context.textContent).not.toContain("后端工程师");
    expect(context.textContent).not.toContain("面试");
  });
});

describe("首页任务卡里的终态提醒卡", () => {
  it("已取消的提醒卡不再出现在首页", async () => {
    taskApiMocks.listAgentTasks.mockResolvedValue([
      makeReminderTask("cancelled", { id: 31, title: "提醒：投递 A 司" }),
      makeReminderTask("draft", { id: 32, title: "提醒：投递 B 司" }),
    ]);

    render(
      <AntdApp>
        <MemoryRouter>
          <TasksCard />
        </MemoryRouter>
      </AntdApp>,
    );

    expect(await screen.findByText(TITLE_B)).toBeInTheDocument();
    expect(screen.queryByText(TITLE_A)).toBeNull();
    // 「已结束」分组整块不出现：不是靠折叠藏起来，而是根本没进列表（计数也不含它）。
    expect(screen.queryByText(t("tasksCard.finishedCount", { count: 1 }))).toBeNull();
  });
});
