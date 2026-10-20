// SPDX-License-Identifier: Apache-2.0
/** 三阶段条件的参数化矩阵：全部用纯函数 ``computeActivationStages``，不碰 React。
 *
 * 2026-10-13 审计口径钉住两件事：
 * - 资料步骤以 /api/profile 的真实关键字段完整度判定（姓名 + 电话/邮箱）；
 * - 核实步骤空台账不算完成，进度以"已核实 N/M 条主张"/"台账为空"呈现。
 */
import { describe, expect, it } from "vitest";
import type { Profile } from "../../types/profile";
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

/** 资料基线：全部字段为空（接口返回的真实形态是空串 + 空数组，不是 undefined）。 */
function profileWith(overrides: Partial<Profile>): Profile {
  return {
    id: 1,
    photo: "",
    name: "",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    target_city: "",
    job_intent: "",
    personal_website: "",
    github: "",
    summary: "",
    wechat: "",
    birth_date: "",
    id_type: "",
    id_number: "",
    country_region: "",
    native_place: "",
    political_status: "",
    phone_country_code: "+86",
    family_info: "",
    expected_salary: "",
    qq: "",
    advisor: "",
    research_direction: "",
    preferred_industry: "",
    section_order: [],
    educations: [],
    experiences: [],
    campus_experiences: [],
    projects: [],
    skills: [],
    awards: [],
    ...overrides,
  };
}

function stageOf(stats: Stats, key: "facts" | "target" | "deliver", profile?: Profile) {
  return computeActivationStages(stats, profile).find((stage) => stage.key === key);
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
    expect(stages[0].cta?.hint).toContain("关键字段");
    // 没有岗位时，阶段 2 的去处是岗位广场；台账为空时阶段 3 去事实台账录入主张。
    expect(stages[1].cta?.path).toBe("/jobs");
    expect(stages[2].cta?.path).toBe("/claims");
  });

  it("阶段 1：有一条台账或一份简历即完成；两者都为 0 时未完成", () => {
    expect(stageOf(statsWith({}), "facts")?.done).toBe(false);
    expect(stageOf(statsWith({ claim_count: 1 }), "facts")?.done).toBe(true);
    expect(stageOf(statsWith({ resume_count: 1 }), "facts")?.done).toBe(true);
  });

  it("阶段 1：资料关键字段完整（姓名 + 电话/邮箱）即完成——只认真填写 profile 不再卡住", () => {
    // 空库 + 姓名与电话齐了：完成。
    expect(
      stageOf(statsWith({}), "facts", profileWith({ name: "张三", phone: "13800000000" }))?.done,
    ).toBe(true);
    // 联系方式只填邮箱也算齐。
    expect(
      stageOf(statsWith({}), "facts", profileWith({ name: "张三", email: "a@b.c" }))?.done,
    ).toBe(true);
  });

  it("阶段 1：关键字段缺失→资料步骤不显示完成（只填姓名/联系方式缺一不可）", () => {
    expect(stageOf(statsWith({}), "facts", profileWith({ name: "张三" }))?.done).toBe(false);
    expect(stageOf(statsWith({}), "facts", profileWith({ phone: "13800000000" }))?.done).toBe(
      false,
    );
    // 关键字段缺失时 CTA 指向我的资料，并点名缺什么。
    const stage = stageOf(statsWith({}), "facts", profileWith({ name: "张三" }));
    expect(stage?.cta?.path).toBe("/profile");
    expect(stage?.cta?.hint).toContain("姓名与联系方式");
  });

  it("阶段 1：profile 加载失败/未就绪时退回台账/简历计数判定（不阻断面板）", () => {
    expect(stageOf(statsWith({ claim_count: 1 }), "facts", undefined)?.done).toBe(true);
    expect(stageOf(statsWith({}), "facts", undefined)?.done).toBe(false);
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

  it("阶段 3：空台账不等于完成事实核实——未核实任何主张时不得显示已完成", () => {
    // 有简历但台账为空：不算完成，进度显示"台账为空"，CTA 去台账录入。
    const emptyLedger = stageOf(statsWith({ resume_count: 1 }), "deliver");
    expect(emptyLedger?.done).toBe(false);
    expect(emptyLedger?.progress).toContain("台账为空");
    expect(emptyLedger?.cta?.path).toBe("/claims");
  });

  it("阶段 3：有简历且台账全部核实才完成；进度显示真实比例", () => {
    const partial = stageOf(
      statsWith({ resume_count: 1, claim_count: 5, pending_claim_count: 2 }),
      "deliver",
    );
    expect(partial?.done).toBe(false);
    expect(partial?.progress).toBe("已核实 3/5 条主张");
    expect(partial?.cta?.label).toBe("核实 2 条待确认事实");
    expect(partial?.cta?.path).toBe("/claims");
    expect(partial?.cta?.hint).toContain("不会进简历");

    // 全部核实且有简历：完成（投递队列为空不影响——交付动作不判定完成）。
    const allVerified = stageOf(
      statsWith({ resume_count: 1, claim_count: 5, pending_claim_count: 0, apply_queue_count: 0 }),
      "deliver",
    );
    expect(allVerified?.done).toBe(true);
    expect(allVerified?.progress).toBe("已核实 5/5 条主张");
  });

  it("阶段 3：主张全部核实但没有简历时仍未完成，CTA 转向简历中心", () => {
    const stage = stageOf(statsWith({ claim_count: 4, pending_claim_count: 0 }), "deliver");
    expect(stage?.done).toBe(false);
    expect(stage?.cta?.path).toBe("/resumes");
  });

  it("阶段 3 的完成不因『交付动作』改变：投递队列是否有货不影响条件（诚实口径）", () => {
    expect(
      stageOf(
        statsWith({
          resume_count: 1,
          claim_count: 2,
          pending_claim_count: 0,
          apply_queue_count: 3,
        }),
        "deliver",
      )?.done,
    ).toBe(true);
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
