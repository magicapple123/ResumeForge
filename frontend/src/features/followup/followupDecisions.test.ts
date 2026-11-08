// SPDX-License-Identifier: Apache-2.0
/**
 * 跟进巡检卡的纯映射（T06）：来源判定、track_id 校验、提交体组装、响应回写。
 *
 * 这些断言对应的都是"会静默出错"的位置：把已处理的步骤再提交一次、把非整数 track_id
 * 塞进请求体、把未知 status 写进任务状态——界面上都不会立刻报错，只有单元测试能钉住。
 */
import { describe, expect, it } from "vitest";
import type { AgentTask, AgentTaskStep } from "../../api/agentTasks";
import {
  applyFollowupResponse,
  buildFollowupDecisions,
  followupBucketKind,
  incompleteFollowupCount,
  isFollowupDone,
  isFollowupTask,
  pendingFollowupSteps,
  resolveFollowupStatus,
  selectedFollowupCount,
  trackIdOfStep,
} from "./followupDecisions";

function makeStep(
  stepIndex: number,
  kind: string,
  status: AgentTaskStep["status"],
  trackId: unknown = stepIndex + 5,
): AgentTaskStep {
  return {
    step_index: stepIndex,
    kind,
    title: `Job ${stepIndex}`,
    status,
    input_digest: `digest-${stepIndex}`,
    output_ref: trackId === null ? null : { track_id: trackId },
    attempt: 0,
    error: "",
    started_at: null,
    finished_at: null,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
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
    steps: [makeStep(0, "followup", "pending", 5), makeStep(1, "followup", "pending", 9)],
    ...overrides,
  };
}

describe("isFollowupTask", () => {
  it("只认 source === followup，不按标题猜", () => {
    expect(isFollowupTask(makeTask())).toBe(true);
    expect(isFollowupTask(makeTask({ source: "manual" }))).toBe(false);
    expect(isFollowupTask(makeTask({ source: "" }))).toBe(false);
  });
});

describe("trackIdOfStep", () => {
  it("只接受正整数；缺字段 / 浮点 / 0 / 字符串都判为不可处理", () => {
    expect(trackIdOfStep(makeStep(0, "followup", "pending", 7))).toBe(7);
    expect(trackIdOfStep(makeStep(0, "followup", "pending", null))).toBeNull();
    expect(trackIdOfStep(makeStep(0, "followup", "pending", 1.5))).toBeNull();
    expect(trackIdOfStep(makeStep(0, "followup", "pending", 0))).toBeNull();
    expect(trackIdOfStep(makeStep(0, "followup", "pending", "7"))).toBeNull();
    expect(trackIdOfStep({ ...makeStep(0, "followup", "pending"), output_ref: {} })).toBeNull();
  });
});

describe("桶与完成判定", () => {
  it("桶名取第一个可识别的 kind；未知 kind 不猜", () => {
    expect(followupBucketKind(makeTask())).toBe("followup");
    expect(followupBucketKind(makeTask({ steps: [makeStep(0, "confirm", "pending")] }))).toBe(
      "confirm",
    );
    expect(followupBucketKind(makeTask({ steps: [makeStep(0, "mystery", "pending")] }))).toBeNull();
  });

  it("done / skipped 的步骤不再待处理；全部终态时整卡算处理完", () => {
    const mixed = makeTask({
      steps: [
        makeStep(0, "followup", "done"),
        makeStep(1, "followup", "pending"),
        makeStep(2, "followup", "skipped"),
      ],
    });
    expect(pendingFollowupSteps(mixed).map((step) => step.step_index)).toEqual([1]);
    expect(isFollowupDone(mixed)).toBe(false);
    const finished = makeTask({
      steps: [makeStep(0, "followup", "done"), makeStep(1, "followup", "skipped")],
    });
    expect(isFollowupDone(finished)).toBe(true);
  });
});

describe("buildFollowupDecisions", () => {
  it("只提交已选且可处理的步骤，按 step_index 升序（乱序选择也稳定）", () => {
    const task = makeTask();
    const decisions = buildFollowupDecisions(task, { 1: "stopped", 0: "contacted" });
    expect(decisions).toEqual([
      { track_id: 5, decision: "contacted" },
      { track_id: 9, decision: "stopped" },
    ]);
  });

  it("已 done 的步骤不再进提交体，即使本地还留着它的选择", () => {
    const task = makeTask({
      steps: [makeStep(0, "followup", "done", 5), makeStep(1, "followup", "pending", 9)],
    });
    expect(buildFollowupDecisions(task, { 0: "contacted", 1: "replied" })).toEqual([
      { track_id: 9, decision: "replied" },
    ]);
  });

  it("track_id 非法的步骤不进提交体，也不阻塞其它步骤", () => {
    const task = makeTask({
      steps: [makeStep(0, "followup", "pending", null), makeStep(1, "followup", "pending", 9)],
    });
    expect(buildFollowupDecisions(task, { 0: "contacted", 1: "replied" })).toEqual([
      { track_id: 9, decision: "replied" },
    ]);
    expect(incompleteFollowupCount(task, { 1: "replied" })).toBe(0);
    expect(selectedFollowupCount(task, { 0: "contacted", 1: "replied" })).toBe(1);
  });

  it("没选的步骤算未完成（提交按钮据此禁用）", () => {
    const task = makeTask();
    expect(incompleteFollowupCount(task, { 0: "contacted" })).toBe(1);
    expect(selectedFollowupCount(task, { 0: "contacted" })).toBe(1);
  });
});

describe("applyFollowupResponse", () => {
  it("按 step_index 回写状态，未知协议值保留原状态，任务状态取响应", () => {
    const task = makeTask();
    const next = applyFollowupResponse(task, {
      task_id: 12,
      status: "done",
      decided: 2,
      created_rows: 2,
      idempotent: false,
      steps: [
        {
          step_index: 1,
          kind: "followup",
          title: "Job 1",
          status: "done",
          output_ref: { track_id: 9 },
        },
        {
          step_index: 0,
          kind: "followup",
          title: "Job 0",
          status: "mystery",
          output_ref: { track_id: 5 },
        },
      ],
    });
    expect(next.status).toBe("done");
    expect(next.steps[1].status).toBe("done");
    // 未知状态不写进 AgentTaskStep.status（保留 pending，避免把真实状态映射成别的）
    expect(next.steps[0].status).toBe("pending");
    // 快照没带的字段沿用原步骤
    expect(next.steps[0].input_digest).toBe("digest-0");
  });

  it("响应 status 不认识时按步骤是否全 done 推导", () => {
    const task = makeTask();
    const allDone = [
      { ...task.steps[0], status: "done" as const },
      { ...task.steps[1], status: "done" as const },
    ];
    expect(
      resolveFollowupStatus(
        { task_id: 12, status: "weird", decided: 2, created_rows: 2, idempotent: false, steps: [] },
        allDone,
      ),
    ).toBe("done");
    expect(
      resolveFollowupStatus(
        { task_id: 12, status: "weird", decided: 1, created_rows: 1, idempotent: false, steps: [] },
        task.steps,
      ),
    ).toBe("draft");
  });
});
