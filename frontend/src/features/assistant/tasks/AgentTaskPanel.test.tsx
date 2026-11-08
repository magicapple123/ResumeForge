/**
 * AgentTaskPanel（T02/T03）：首页「任务」卡的分组顺序、3 条上限、已结束折叠、
 * 手风琴展开与「当前这步」标记。
 *
 * 断言文案一律走 t(...)（cjkRatchet 把测试里的中文断言也算作"待迁移文案"，
 * 该文件基线是 0）；定位优先用 role / testid。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, AgentTaskStatus, AgentTaskStepStatus } from "../../../api/agentTasks";
import { t, type MessageKey } from "../../../i18n";
import AgentTaskPanel from "./AgentTaskPanel";
import { HOME_BUCKET_ORDER } from "./agentTaskView";

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
  if (status === "running") steps[completed].status = "running";
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
        bucketOrder={HOME_BUCKET_ORDER}
        activeLimit={3}
        finishedPreviewLimit={5}
        onStart={onStart}
        onResume={onResume}
        onCancel={onCancel}
      />
    </AntdApp>,
  );
  return { onStart, onResume, onCancel };
}

/** 元素 A 是否排在 B 前面（D2 组顺序断言用）。 */
function isBefore(a: HTMLElement, b: HTMLElement): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

afterEach(() => cleanup());

describe("AgentTaskPanel", () => {
  it("待确认在前、进行中在后、已结束最后（D2）", () => {
    renderPanel([makeTask(1, "running"), makeTask(2, "waiting_approval")]);

    const waiting = screen.getByTestId("agent-task-2");
    const running = screen.getByTestId("agent-task-1");
    expect(isBefore(waiting, running)).toBe(true);
    expect(
      screen.getAllByText(t("assistantUi.tasks.progress", { current: 1, total: 3 })).length,
    ).toBeGreaterThan(0);
  });

  it("未结束任务合计最多 3 条，超出收成「还有 N 条」并可就地展开", () => {
    renderPanel([
      makeTask(1, "running"),
      makeTask(2, "running"),
      makeTask(3, "running"),
      makeTask(4, "running"),
      makeTask(5, "running"),
    ]);

    expect(screen.getByTestId("agent-task-1")).toBeTruthy();
    expect(screen.getByTestId("agent-task-3")).toBeTruthy();
    expect(screen.queryByTestId("agent-task-4")).toBeNull();
    const more = screen.getByRole("button", {
      name: t("tasksCard.more", { count: 2 }),
    });
    fireEvent.click(more);
    expect(screen.getByTestId("agent-task-4")).toBeTruthy();
    expect(screen.getByTestId("agent-task-5")).toBeTruthy();
  });

  it("「已结束(N)」默认收起，展开先显示最近 5 条 + 查看全部（D3）", () => {
    const finished = Array.from({ length: 7 }, (_, index) => makeTask(10 + index, "done"));
    renderPanel([makeTask(1, "running"), ...finished]);

    expect(screen.queryByTestId("agent-task-10")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("tasksCard.finishedCount", { count: 7 }) }),
    );
    expect(screen.getByTestId("agent-task-10")).toBeTruthy();
    expect(screen.getByTestId("agent-task-14")).toBeTruthy();
    expect(screen.queryByTestId("agent-task-15")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("homePage.action.viewAll") }));
    expect(screen.getByTestId("agent-task-16")).toBeTruthy();
  });

  it("手风琴：同一时间只展开一条任务的步骤（T03）", () => {
    renderPanel([makeTask(1, "running"), makeTask(2, "running")]);

    const stepsButton = buttonName("assistantUi.tasks.action.steps");
    fireEvent.click(
      within(screen.getByTestId("agent-task-1")).getByRole("button", { name: stepsButton }),
    );
    expect(
      within(screen.getByTestId("agent-task-1")).getByRole("list", {
        name: t("assistantUi.tasks.steps"),
      }),
    ).toBeTruthy();

    fireEvent.click(
      within(screen.getByTestId("agent-task-2")).getByRole("button", { name: stepsButton }),
    );
    // 第二条展开后第一条自动收起：步骤清单只剩一份。
    expect(screen.getAllByRole("list", { name: t("assistantUi.tasks.steps") })).toHaveLength(1);
    expect(
      within(screen.getByTestId("agent-task-1")).queryByRole("list", {
        name: t("assistantUi.tasks.steps"),
      }),
    ).toBeNull();
  });

  it("展开后「当前这步」加粗并带「当前」标签，全部完成则不标（T03）", () => {
    renderPanel([makeTask(1, "running"), makeTask(2, "done")]);
    // 已结束区默认收起：先展开它才能看到"全部完成"的那条。
    fireEvent.click(
      screen.getByRole("button", { name: t("tasksCard.finishedCount", { count: 1 }) }),
    );

    const stepsButton = buttonName("assistantUi.tasks.action.steps");
    fireEvent.click(
      within(screen.getByTestId("agent-task-1")).getByRole("button", { name: stepsButton }),
    );
    const current = within(screen.getByTestId("agent-task-1")).getByTestId("agent-task-current-1");
    expect(current.textContent).toBe(t("assistantUi.tasks.current"));
    // 当前步标题加粗（第二个步骤是 running）。
    expect(current.closest("li")?.querySelector("strong")?.textContent).toBe(STEP_TITLES[1]);

    fireEvent.click(
      within(screen.getByTestId("agent-task-2")).getByRole("button", { name: stepsButton }),
    );
    expect(
      within(screen.getByTestId("agent-task-2")).queryByTestId("agent-task-current-2"),
    ).toBeNull();
    // 手风琴：展开第二条后第一条自动收起。
    expect(
      within(screen.getByTestId("agent-task-1")).queryByTestId("agent-task-current-1"),
    ).toBeNull();
  });

  it("状态决定的按钮：开始 / 继续 / 去确认 / 取消任务", () => {
    const { onStart, onResume, onCancel } = renderPanel([
      makeTask(4, "draft"),
      makeTask(5, "paused"),
      makeTask(6, "waiting_approval"),
      makeTask(7, "done"),
    ]);
    // 终态在「已结束」区里：先展开该区，才能验证终态不提供操作。
    fireEvent.click(
      screen.getByRole("button", { name: t("tasksCard.finishedCount", { count: 1 }) }),
    );

    fireEvent.click(
      within(screen.getByTestId("agent-task-4")).getByRole("button", {
        name: buttonName("assistantUi.tasks.action.start"),
      }),
    );
    expect(onStart).toHaveBeenCalledWith(4);
    fireEvent.click(
      within(screen.getByTestId("agent-task-5")).getByRole("button", {
        name: buttonName("assistantUi.tasks.action.resume"),
      }),
    );
    expect(onResume).toHaveBeenCalledWith(5);
    fireEvent.click(
      within(screen.getByTestId("agent-task-6")).getByRole("button", {
        name: buttonName("assistantUi.tasks.action.review"),
      }),
    );
    // 「去确认」就是展开这一步给用户看等哪一步（手风琴同样只展开一条）。
    expect(
      within(screen.getByTestId("agent-task-6")).getByRole("list", {
        name: t("assistantUi.tasks.steps"),
      }),
    ).toBeTruthy();
    fireEvent.click(
      within(screen.getByTestId("agent-task-6")).getByRole("button", {
        name: buttonName("assistantUi.tasks.action.cancel"),
      }),
    );
    expect(onCancel).toHaveBeenCalledWith(6);
    // 终态不提供操作。
    expect(
      within(screen.getByTestId("agent-task-7")).queryByRole("button", {
        name: buttonName("assistantUi.tasks.action.cancel"),
      }),
    ).toBeNull();
  });

  it("错误提示与空任务：没有任务时不渲染内容", () => {
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
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <AntdApp>
        <AgentTaskPanel
          tasks={[makeTask(1, "running")]}
          error={t("assistantUi.tasks.error")}
          onStart={vi.fn()}
          onResume={vi.fn()}
          onCancel={vi.fn()}
        />
      </AntdApp>,
    );
    expect(screen.getByRole("status").textContent).toBe(t("assistantUi.tasks.error"));
    expect(screen.getByTestId("agent-task-1")).toBeTruthy();
  });
});
