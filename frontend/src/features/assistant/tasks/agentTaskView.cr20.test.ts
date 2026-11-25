// SPDX-License-Identifier: Apache-2.0
/**
 * CR-20：终态提醒卡在**两个展示位**都不出现（首页卡 / 助手任务条共用这一份口径）。
 *
 * 首页拆卡后（CR-19）终态卡本来就进不了「待你确认 / 任务」两张卡（它们只收未结束），
 * 所以从界面断言反推不出这条守卫。这里直接钉纯函数：`visibleCardTasks` 必须滤掉
 * 「来源=提醒 且 已结束」的卡，D5 空壳过滤与终态提醒隐藏是两条独立规则。
 */
import { describe, expect, it } from "vitest";
import type { AgentTask } from "../../../api/agentTasks";
import { visibleCardTasks } from "./agentTaskView";

function makeTask(patch: Partial<AgentTask>): AgentTask {
  return {
    id: 1,
    conversation_id: null,
    title: "准备：投递 A 司",
    goal: "",
    status: "draft",
    resume_cursor: 0,
    source: "reminder",
    created_at: "2026-11-25T00:00:00",
    updated_at: "2026-11-25T00:00:00",
    finished_at: null,
    error: "",
    // 带步骤：确保不是被 D5「空壳任务」规则顺手滤掉的。
    steps: [
      {
        step_index: 0,
        kind: "confirm",
        title: "确认：投递 A 司",
        status: "pending",
        input_digest: "",
        output_ref: null,
        attempt: 0,
        error: "",
        started_at: null,
        finished_at: null,
      },
    ],
    ...patch,
  };
}

describe("visibleCardTasks 的终态提醒卡口径（CR-20）", () => {
  it.each(["done", "failed", "cancelled"] as const)("结束态（%s）的提醒卡被滤掉", (status) => {
    const tasks = [makeTask({ id: 1, status })];
    expect(visibleCardTasks(tasks)).toHaveLength(0);
  });

  it("未结束的提醒卡保留（首页要用专门行渲染它）", () => {
    expect(visibleCardTasks([makeTask({ id: 2, status: "draft" })])).toHaveLength(1);
  });

  it("其它来源的终态任务不受影响（只有提醒卡按这个口径隐藏）", () => {
    const tasks = [makeTask({ id: 3, status: "done", source: "manual" })];
    expect(visibleCardTasks(tasks)).toHaveLength(1);
  });
});
