// SPDX-License-Identifier: Apache-2.0
/**
 * 跟进巡检卡（T06）交互：三家可乱序选择、整卡一次提交、按响应更新、幂等提示、
 * 重复点击不重复请求、确认状态桶没有"发跟进"类动作。
 *
 * 文案断言一律走 t(...)（cjkRatchet 把测试里的中文 ByText 断言也算作待迁移文案）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, AgentTaskStatus, AgentTaskStep } from "../../api/agentTasks";
import { submitFollowupDecisions, type FollowupDecisionResponse } from "../../api/followups";
import { t } from "../../i18n";
import FollowupCard from "./FollowupCard";

vi.mock("../../api/followups", () => ({ submitFollowupDecisions: vi.fn() }));
const submitMock = vi.mocked(submitFollowupDecisions);

function makeStep(
  stepIndex: number,
  kind: string,
  status: AgentTaskStep["status"] = "pending",
): AgentTaskStep {
  return {
    step_index: stepIndex,
    kind,
    title: `Job ${stepIndex}`,
    status,
    input_digest: "",
    output_ref: { track_id: [5, 9, 13][stepIndex] ?? stepIndex + 5 },
    attempt: 0,
    error: "",
    started_at: null,
    finished_at: null,
  };
}

function makeTask(steps: AgentTaskStep[], overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 12,
    conversation_id: null,
    title: "Follow up",
    goal: "",
    status: "draft",
    resume_cursor: 0,
    source: "followup",
    created_at: "2026-11-09T00:00:00",
    updated_at: "2026-11-09T00:00:00",
    finished_at: null,
    error: "",
    steps,
    ...overrides,
  };
}

function response(
  steps: Array<{ step_index: number; status: string }>,
  overrides: Partial<FollowupDecisionResponse> = {},
): FollowupDecisionResponse {
  return {
    task_id: 12,
    status: "done",
    decided: steps.length,
    created_rows: steps.length,
    idempotent: false,
    steps: steps.map((step) => ({
      step_index: step.step_index,
      kind: "followup",
      title: `Job ${step.step_index}`,
      status: step.status,
      output_ref: { track_id: [5, 9, 13][step.step_index] ?? step.step_index + 5 },
    })),
    ...overrides,
  };
}

function renderCard(task: AgentTask) {
  render(
    <AntdApp>
      <FollowupCard task={task} />
    </AntdApp>,
  );
}

function pickDecision(row: HTMLElement, decisionKey: Parameters<typeof t>[0]) {
  fireEvent.click(within(row).getByRole("radio", { name: t(decisionKey) }));
}

afterEach(() => {
  cleanup();
  submitMock.mockReset();
});

describe("FollowupCard", () => {
  it("每个步骤三选一；没选全时提交按钮禁用并提示还差几条", () => {
    renderCard(makeTask([makeStep(0, "followup"), makeStep(1, "followup")]));
    const row0 = screen.getByTestId("followup-step-12-0");
    expect(within(row0).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText(t("followupSweep.hint.incomplete", { count: 2 }))).toBeTruthy();
    const submit = screen.getByTestId("followup-submit-12") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    pickDecision(row0, "followupSweep.decision.contacted");
    // 后端允许部分提交：选了一条即可先提交已选的，剩下那条下次再处理。
    expect(screen.getByText(t("followupSweep.hint.partial", { count: 1 }))).toBeTruthy();
    expect((screen.getByTestId("followup-submit-12") as HTMLButtonElement).disabled).toBe(false);
  });

  it("部分提交只带已选的决策；未选的步骤提交后仍可继续处理", async () => {
    submitMock.mockResolvedValue(
      response([{ step_index: 0, status: "done" }], {
        status: "draft",
        decided: 1,
        created_rows: 1,
      }),
    );
    renderCard(makeTask([makeStep(0, "followup"), makeStep(1, "followup")]));
    pickDecision(screen.getByTestId("followup-step-12-0"), "followupSweep.decision.contacted");
    fireEvent.click(screen.getByTestId("followup-submit-12"));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith(12, [{ track_id: 5, decision: "contacted" }]);
    // 第一家显示已记录，第二家还能选（卡仍是 draft）。
    await screen.findByText(t("followupSweep.state.stepDone"));
    expect(screen.queryByText(t("followupSweep.state.done"))).toBeNull();
    expect(within(screen.getByTestId("followup-step-12-1")).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByTestId("followup-submit-12")).toBeTruthy();
  });

  it("乱序选择后整卡一次提交，提交体按 step_index 排序并带全部决策", async () => {
    submitMock.mockResolvedValue(response([{ step_index: 0, status: "done" }]));
    renderCard(makeTask([makeStep(0, "followup"), makeStep(1, "followup")]));
    // 先处理第二家，再处理第一家（顺序不影响提交内容）。
    pickDecision(screen.getByTestId("followup-step-12-1"), "followupSweep.decision.stopped");
    pickDecision(screen.getByTestId("followup-step-12-0"), "followupSweep.decision.contacted");
    const submit = screen.getByTestId("followup-submit-12") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith(12, [
      { track_id: 5, decision: "contacted" },
      { track_id: 9, decision: "stopped" },
    ]);
    // 提交中按钮转圈，不再可点。
    await waitFor(() =>
      expect(screen.getByTestId("followup-submit-12").className).toContain("ant-btn-loading"),
    );
  });

  it("提交后按响应把步骤显示为已记录，整卡显示处理完且不再有提交按钮", async () => {
    submitMock.mockResolvedValue(
      response([
        { step_index: 0, status: "done" },
        { step_index: 1, status: "done" },
      ]),
    );
    renderCard(makeTask([makeStep(0, "followup"), makeStep(1, "followup")]));
    pickDecision(screen.getByTestId("followup-step-12-0"), "followupSweep.decision.contacted");
    pickDecision(screen.getByTestId("followup-step-12-1"), "followupSweep.decision.replied");
    fireEvent.click(screen.getByTestId("followup-submit-12"));

    await screen.findByText(t("followupSweep.state.done"));
    expect(screen.queryByTestId("followup-submit-12")).toBeNull();
    expect(screen.getAllByText(t("followupSweep.state.stepDone"))).toHaveLength(2);
    await screen.findByText(t("followupSweep.toast.submitted", { count: 2 }));
  });

  it("幂等响应（created_rows=0 / idempotent=true）提示已记录过，不谎报新增", async () => {
    submitMock.mockResolvedValue(
      response([{ step_index: 0, status: "done" }], {
        decided: 1,
        created_rows: 0,
        idempotent: true,
      }),
    );
    renderCard(makeTask([makeStep(0, "followup")]));
    pickDecision(screen.getByTestId("followup-step-12-0"), "followupSweep.decision.stopped");
    fireEvent.click(screen.getByTestId("followup-submit-12"));
    await screen.findByText(t("followupSweep.toast.idempotent"));
  });

  it("提交进行中重复点击只发一次请求（前端也要防双击，不能只靠后端幂等）", async () => {
    let resolveSubmit: (value: FollowupDecisionResponse) => void = () => undefined;
    submitMock.mockReturnValue(
      new Promise<FollowupDecisionResponse>((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    renderCard(makeTask([makeStep(0, "followup")]));
    pickDecision(screen.getByTestId("followup-step-12-0"), "followupSweep.decision.contacted");
    const submit = screen.getByTestId("followup-submit-12");
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(submitMock).toHaveBeenCalledTimes(1);
    resolveSubmit(response([{ step_index: 0, status: "done" }]));
    await screen.findByText(t("followupSweep.state.done"));
  });

  it("提交失败给出可重试的提示，按钮恢复可点", async () => {
    submitMock.mockRejectedValue(new Error("network down"));
    renderCard(makeTask([makeStep(0, "followup")]));
    pickDecision(screen.getByTestId("followup-step-12-0"), "followupSweep.decision.contacted");
    fireEvent.click(screen.getByTestId("followup-submit-12"));
    await screen.findByText("network down");
    await waitFor(() =>
      expect((screen.getByTestId("followup-submit-12") as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("确认状态桶只给决策按钮，没有发跟进类动作", () => {
    renderCard(makeTask([makeStep(0, "confirm"), makeStep(1, "confirm")]));
    expect(screen.getByText(t("followupSweep.kind.confirm"))).toBeTruthy();
    expect(screen.queryByText(t("followupSweep.kind.followup"))).toBeNull();
    // 卡里只有「记录这次处理」一个动作按钮；三选一是 radio，不是"发跟进"按钮。
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBe(screen.getByTestId("followup-submit-12"));
    expect(screen.queryByText(/follow/i)).toBeNull();
  });

  it("track_id 缺失的步骤不提供选择，也不阻塞其它步骤提交", async () => {
    submitMock.mockResolvedValue(response([{ step_index: 1, status: "done" }]));
    const broken: AgentTaskStep = {
      ...makeStep(0, "followup"),
      output_ref: null,
    };
    renderCard(makeTask([broken, makeStep(1, "followup")]));
    expect(within(screen.getByTestId("followup-step-12-0")).queryAllByRole("radio")).toHaveLength(
      0,
    );
    pickDecision(screen.getByTestId("followup-step-12-1"), "followupSweep.decision.replied");
    fireEvent.click(screen.getByTestId("followup-submit-12"));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith(12, [{ track_id: 9, decision: "replied" }]);
  });

  it("步骤已处理完时直接显示整卡完成，不请求也不给选择", () => {
    renderCard(makeTask([makeStep(0, "followup", "done")]));
    expect(screen.getByText(t("followupSweep.state.done"))).toBeTruthy();
    expect(screen.queryByTestId("followup-submit-12")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});

describe("FollowupCard 任务状态回写", () => {
  it("响应把任务标为 done 时整卡进入完成态（AgentTaskStatus 由响应采用）", async () => {
    submitMock.mockResolvedValue(
      response([{ step_index: 0, status: "done" }], { status: "done" satisfies AgentTaskStatus }),
    );
    renderCard(makeTask([makeStep(0, "followup")]));
    pickDecision(screen.getByTestId("followup-step-12-0"), "followupSweep.decision.contacted");
    fireEvent.click(screen.getByTestId("followup-submit-12"));
    await screen.findByText(t("followupSweep.state.done"));
  });
});
