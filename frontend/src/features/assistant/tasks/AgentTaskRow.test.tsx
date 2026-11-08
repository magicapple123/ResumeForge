// SPDX-License-Identifier: Apache-2.0
/**
 * 任务卡按来源分支（T06）：source === followup 的卡整行交给 FollowupCard——
 * 没有"开始 / 取消 / 步骤"这些通用任务动作，也不按普通步骤清单渲染。
 *
 * 「确认状态」桶尤其不能出现"发跟进"类动作：长期没有记录到状态变化时，催跟进等于拿
 * 旧数据制造噪音；用户要做的只是确认状态。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, AgentTaskStep } from "../../../api/agentTasks";
import { t } from "../../../i18n";
import AgentTaskRow from "./AgentTaskRow";

function makeStep(stepIndex: number, kind: string): AgentTaskStep {
  return {
    step_index: stepIndex,
    kind,
    title: `Job ${stepIndex}`,
    status: "pending",
    input_digest: "",
    output_ref: { track_id: stepIndex + 5 },
    attempt: 0,
    error: "",
    started_at: null,
    finished_at: null,
  };
}

function makeTask(steps: AgentTaskStep[]): AgentTask {
  return {
    id: 31,
    conversation_id: null,
    title: "Task title",
    goal: "",
    status: "draft",
    resume_cursor: 0,
    source: "followup",
    created_at: "2026-11-09T00:00:00",
    updated_at: "2026-11-09T00:00:00",
    finished_at: null,
    error: "",
    steps,
  };
}

function renderRow(task: AgentTask) {
  render(
    <AntdApp>
      <ul>
        <AgentTaskRow
          task={task}
          expanded
          onToggleExpanded={vi.fn()}
          onStart={vi.fn()}
          onResume={vi.fn()}
          onCancel={vi.fn()}
        />
      </ul>
    </AntdApp>,
  );
}

afterEach(() => cleanup());

describe("AgentTaskRow 的跟进巡检分支", () => {
  it("followup 来源渲染 FollowupCard，不出现开始 / 取消 / 展开步骤按钮", () => {
    renderRow(makeTask([makeStep(0, "followup"), makeStep(1, "followup")]));
    expect(screen.getByTestId("followup-card-31")).toBeTruthy();
    expect(screen.getByTestId("agent-task-source-31")).toHaveTextContent(
      t("followupSweep.sourceBadge"),
    );
    const buttonNames = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    expect(buttonNames.some((name) => name.includes(t("assistantUi.tasks.action.cancel")))).toBe(
      false,
    );
    expect(buttonNames.some((name) => name.includes(t("assistantUi.tasks.action.start")))).toBe(
      false,
    );
    expect(buttonNames.some((name) => name.includes(t("assistantUi.tasks.action.steps")))).toBe(
      false,
    );
    // 步骤直接铺开（不折叠），当前步骤标记也不出现。
    expect(screen.getByTestId("followup-step-31-0")).toBeTruthy();
    expect(screen.queryByTestId("agent-task-current-31")).toBeNull();
  });

  it("确认状态桶只给三种决策与整卡提交，没有任何发跟进动作", () => {
    renderRow(makeTask([makeStep(0, "confirm"), makeStep(1, "confirm")]));
    expect(screen.getByText(t("followupSweep.kind.confirm"))).toBeTruthy();
    expect(screen.queryByText(t("followupSweep.kind.followup"))).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getAllByRole("radio")).toHaveLength(6);
  });

  it("非 followup 来源仍按通用任务行渲染（开始按钮在）", () => {
    const manual = { ...makeTask([makeStep(0, "custom")]), source: "manual" };
    renderRow(manual);
    expect(screen.queryByTestId("followup-card-31")).toBeNull();
    // antd 会把两字中文按钮排成「开 始」，按去空白后的文本比对，不绑死排版细节。
    const names = screen
      .getAllByRole("button")
      .map((button) => (button.textContent ?? "").replace(/\s+/g, ""));
    expect(names).toContain(t("assistantUi.tasks.action.start").replace(/\s+/g, ""));
  });
});
