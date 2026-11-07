/**
 * AgentTaskPanel (T20)：分区渲染、按状态给出的操作、折叠与空/错误态。
 *
 * 断言文案一律走 t(...)（cjkRatchet 把测试里的中文断言也算作"待迁移文案"，
 * 新用例用 role/label 定位就不占额度）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, AgentTaskStatus, AgentTaskStepStatus } from "../../../api/agentTasks";
import { t, type MessageKey } from "../../../i18n";
import AgentTaskPanel from "./AgentTaskPanel";

const STEP_TITLES = ["Collect requirements", "Rewrite resume", "Export PDF"];

/**
 * antd Button 会把「恰好两个汉字」的按钮文案排成「开 始」（autoInsertSpace），
 * 无障碍名也带着这个空格。这里按"字符之间允许空白"匹配，避免断言绑死在排版细节上。
 */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buttonName(key: MessageKey): RegExp {
  return new RegExp(t(key).split("").map(escapeRegExp).join("\\s*"));
}

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
    conversation_id: 7,
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

function renderPanel(tasks: AgentTask[], options: { error?: string | null } = {}) {
  const onStart = vi.fn();
  const onResume = vi.fn();
  const onCancel = vi.fn();
  render(
    <AntdApp>
      <AgentTaskPanel
        tasks={tasks}
        error={options.error ?? null}
        onStart={onStart}
        onResume={onResume}
        onCancel={onCancel}
      />
    </AntdApp>,
  );
  return { onStart, onResume, onCancel };
}

afterEach(() => {
  cleanup();
});

describe("AgentTaskPanel", () => {
  it("groups tasks into active, waiting and finished sections with progress", () => {
    renderPanel([makeTask(1, "running"), makeTask(2, "waiting_approval"), makeTask(3, "done")]);

    expect(screen.getByText(t("assistantUi.tasks.title"))).toBeTruthy();
    expect(screen.getByText(t("assistantUi.tasks.count", { count: 3 }))).toBeTruthy();
    // 分组标题与状态标签可能同名（例如「进行中」），这里按"至少出现一次"断言。
    expect(screen.getAllByText(t("assistantUi.tasks.group.active")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("assistantUi.tasks.group.waiting")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("assistantUi.tasks.group.finished"))).toBeTruthy();

    const running = screen.getByTestId("agent-task-1");
    expect(
      within(running).getByText(t("assistantUi.tasks.progress", { current: 1, total: 3 })),
    ).toBeTruthy();
    const finished = screen.getByTestId("agent-task-3");
    expect(
      within(finished).getByText(t("assistantUi.tasks.progress", { current: 3, total: 3 })),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("agent-task-2")).getByText(t("assistantUi.tasks.waitingHint")),
    ).toBeTruthy();
  });

  it("marks reminder-generated tasks with a source badge", () => {
    renderPanel([
      makeTask(21, "draft", { source: "reminder", conversation_id: null }),
      makeTask(22, "draft"),
      makeTask(23, "draft", { source: "custom-import" }),
    ]);

    // 提醒事件生成的任务没有会话归属，用户必须能看出它不是自己刚建的。
    const reminder = screen.getByTestId("agent-task-21");
    expect(within(reminder).getByTestId("agent-task-source-21").textContent).toBe(
      t("assistantUi.tasks.source.reminder"),
    );

    // 手动建的卡不加徽标：满屏「来源：手动」只是噪音。
    expect(
      within(screen.getByTestId("agent-task-22")).queryByTestId("agent-task-source-22"),
    ).toBeNull();

    // 未知来源如实显示原始标签，不伪装成「提醒」。
    expect(
      within(screen.getByTestId("agent-task-23")).getByTestId("agent-task-source-23").textContent,
    ).toBe(t("assistantUi.tasks.source.other", { source: "custom-import" }));
  });

  it("shows status-specific actions and reports clicks", () => {
    const { onStart, onResume, onCancel } = renderPanel([
      makeTask(4, "draft"),
      makeTask(5, "paused"),
      makeTask(6, "running"),
      makeTask(7, "waiting_approval"),
      makeTask(8, "done"),
    ]);

    const draft = screen.getByTestId("agent-task-4");
    fireEvent.click(
      within(draft).getByRole("button", { name: buttonName("assistantUi.tasks.action.start") }),
    );
    expect(onStart).toHaveBeenCalledWith(4);

    const paused = screen.getByTestId("agent-task-5");
    fireEvent.click(
      within(paused).getByRole("button", { name: buttonName("assistantUi.tasks.action.resume") }),
    );
    expect(onResume).toHaveBeenCalledWith(5);

    const running = screen.getByTestId("agent-task-6");
    fireEvent.click(
      within(running).getByRole("button", { name: buttonName("assistantUi.tasks.action.cancel") }),
    );
    expect(onCancel).toHaveBeenCalledWith(6);

    const waiting = screen.getByTestId("agent-task-7");
    fireEvent.click(
      within(waiting).getByRole("button", { name: buttonName("assistantUi.tasks.action.review") }),
    );
    expect(within(waiting).getByRole("list", { name: t("assistantUi.tasks.steps") })).toBeTruthy();
    expect(within(waiting).getByText(STEP_TITLES[1])).toBeTruthy();

    const finished = screen.getByTestId("agent-task-8");
    expect(
      within(finished).queryByRole("button", {
        name: buttonName("assistantUi.tasks.action.cancel"),
      }),
    ).toBeNull();
    expect(
      within(finished).queryByRole("button", {
        name: buttonName("assistantUi.tasks.action.start"),
      }),
    ).toBeNull();
  });

  it("collapses and expands the whole section", () => {
    renderPanel([makeTask(1, "running"), makeTask(2, "done")]);

    fireEvent.click(screen.getByRole("button", { name: t("assistantUi.tasks.collapse") }));
    expect(screen.queryByTestId("agent-task-1")).toBeNull();
    expect(screen.getByText(t("assistantUi.tasks.count", { count: 2 }))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t("assistantUi.tasks.expand") }));
    expect(screen.getByTestId("agent-task-1")).toBeTruthy();
  });

  it("renders nothing while there are no tasks and surfaces a load error", () => {
    const { rerender } = render(
      <AntdApp>
        <AgentTaskPanel
          tasks={[]}
          error={null}
          onStart={vi.fn()}
          onResume={vi.fn()}
          onCancel={vi.fn()}
        />
      </AntdApp>,
    );
    expect(screen.queryByText(t("assistantUi.tasks.title"))).toBeNull();

    rerender(
      <AntdApp>
        <AgentTaskPanel
          tasks={[]}
          error={t("assistantUi.tasks.error")}
          onStart={vi.fn()}
          onResume={vi.fn()}
          onCancel={vi.fn()}
        />
      </AntdApp>,
    );
    expect(screen.getByRole("status").textContent).toBe(t("assistantUi.tasks.error"));
  });
});
