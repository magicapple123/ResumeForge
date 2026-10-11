/** 三阶段条件的参数化矩阵：全部用纯函数 ``computeActivationStages``，不碰 React。 */
import { describe, expect, it } from "vitest";
import type { Stats } from "../../types/search";
import { computeActivationStages } from "./useActivationProgress";

/** 空库基线：后端对每个计数都给明确零值，数组给空列表。 */
function statsWith(overrides: Partial<Stats>): Stats {
  return {
    job_count: 0,
    open_job_count: 0,
    resume_count: 0,
    week_resume_count: 0,
    latest_jobs: [],
    latest_resumes: [],
    favorite_job_count: 0,
    pending_claim_count: 0,
    pending_claims: [],
    stalled_application_count: 0,
    apply_queue_count: 0,
    claim_count: 0,
    resume_with_job_count: 0,
    latest_applications: [],
    ...overrides,
  };
}

function stageOf(stats: Stats, key: "facts" | "target" | "deliver") {
  return computeActivationStages(stats).find((stage) => stage.key === key);
}

const ONE_APPLICATION: Stats["latest_applications"][number] = {
  id: 1,
  job_title: "后端开发",
  company: "示例公司",
  status: "success",
  updated_at: "2026-10-01T10:00:00",
};

describe("activation stage conditions", () => {
  it("空库：三个阶段全部未完成，每阶段都带 CTA", () => {
    const stages = computeActivationStages(statsWith({}));
    expect(stages.map((stage) => stage.done)).toEqual([false, false, false]);
    expect(stages[0].cta?.hint).toContain("不需要模型");
    // 没有岗位时，阶段 2 的去处是岗位广场；没简历也没待核实，阶段 3 去导出/投递。
    expect(stages[1].cta?.path).toBe("/jobs");
    expect(stages[2].cta?.path).toBe("/apply");
  });

  it("阶段 1：有一条台账或一份简历即完成；两者都为 0 时未完成", () => {
    expect(stageOf(statsWith({}), "facts")?.done).toBe(false);
    expect(stageOf(statsWith({ claim_count: 1 }), "facts")?.done).toBe(true);
    expect(stageOf(statsWith({ resume_count: 1 }), "facts")?.done).toBe(true);
  });

  it("阶段 1 CTA 指向我的资料（手动填写不需要模型）", () => {
    const stage = stageOf(statsWith({}), "facts");
    expect(stage?.cta?.label).toBe("去我的资料录入");
    expect(stage?.cta?.path).toBe("/profile");
  });

  it("阶段 2：有岗位且简历/队列/投递任一出现『对着岗位做事』的痕迹才完成", () => {
    // 只有岗位、没有关联动作：未完成，CTA 转向简历。
    const onlyJobs = stageOf(statsWith({ job_count: 3 }), "target");
    expect(onlyJobs?.done).toBe(false);
    expect(onlyJobs?.cta?.path).toBe("/resumes");

    // 三种痕迹任一满足即完成。
    expect(stageOf(statsWith({ job_count: 3, resume_with_job_count: 1 }), "target")?.done).toBe(
      true,
    );
    expect(stageOf(statsWith({ job_count: 3, apply_queue_count: 2 }), "target")?.done).toBe(true);
    expect(
      stageOf(statsWith({ job_count: 3, latest_applications: [ONE_APPLICATION] }), "target")?.done,
    ).toBe(true);

    // 有痕迹但没有岗位：不算完成（对岗位做的事必须先有岗位）。
    expect(stageOf(statsWith({ resume_with_job_count: 1 }), "target")?.done).toBe(false);
  });

  it("阶段 2：没有岗位时 CTA 指向岗位广场", () => {
    const stage = stageOf(statsWith({}), "target");
    expect(stage?.cta?.label).toBe("去岗位广场收岗位");
    expect(stage?.cta?.path).toBe("/jobs");
  });

  it("阶段 3：有简历且无待核实事实才完成；有待核实时 CTA 带数量并指向台账", () => {
    expect(stageOf(statsWith({ resume_count: 1 }), "deliver")?.done).toBe(true);
    expect(stageOf(statsWith({ resume_count: 1, pending_claim_count: 2 }), "deliver")?.done).toBe(
      false,
    );

    const pending = stageOf(statsWith({ resume_count: 1, pending_claim_count: 2 }), "deliver");
    expect(pending?.cta?.label).toBe("核实 2 条待确认事实");
    expect(pending?.cta?.path).toBe("/claims");
    expect(pending?.cta?.hint).toContain("不会进简历");
  });

  it("阶段 3 的完成不因『交付动作』改变：投递队列是否为空不影响条件（诚实口径）", () => {
    expect(stageOf(statsWith({ resume_count: 1, apply_queue_count: 0 }), "deliver")?.done).toBe(
      true,
    );
  });

  it("示例数据（各计数齐全、无待核实）：三阶段全部完成且无 CTA——面板因此不渲染", () => {
    const sample = statsWith({
      job_count: 6,
      resume_count: 3,
      claim_count: 12,
      resume_with_job_count: 2,
    });
    const stages = computeActivationStages(sample);
    expect(stages.every((stage) => stage.done)).toBe(true);
    expect(stages.every((stage) => stage.cta === undefined)).toBe(true);
  });
});
