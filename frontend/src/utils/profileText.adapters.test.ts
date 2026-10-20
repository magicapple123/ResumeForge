// SPDX-License-Identifier: Apache-2.0
/**
 * 识别结果 ↔ 校对清单的适配器（项 13）。
 *
 * 最要紧的一条是**往返无损**：把识别结果摊成清单、什么都不改、再还原回来，必须得到 `{}`
 * （"一个字段都没被改"）。不然用户点「确认填入」时，那些他根本没看过的字段也会被当成
 * "改过的值"写一遍——而写错一次就要靠他自己发现。
 */

import { describe, expect, it } from "vitest";
import type { ProfileTextParseResult } from "../types";
import { profileToReviewRows, reviewRowsToProfile } from "./profileText";

function makeParsed(overrides: Partial<ProfileTextParseResult> = {}): ProfileTextParseResult {
  return {
    photo: "",
    name: "李四",
    gender: "男",
    birth_year: "2000",
    phone: "13800000000",
    email: "lisi@example.com",
    city: "杭州",
    target_city: "",
    job_intent: "后端开发",
    personal_website: "",
    github: "",
    summary: "五年后端经验，负责交易系统。",
    wechat: "",
    birth_date: "",
    id_type: "",
    id_number: "",
    country_region: "",
    native_place: "",
    political_status: "",
    phone_country_code: "",
    family_info: "",
    expected_salary: "",
    qq: "",
    advisor: "",
    research_direction: "",
    preferred_industry: "",
    section_order: [],
    educations: [
      {
        school: "示例大学",
        department: "计算机学院",
        major: "软件工程",
        degree: "本科",
        study_mode: "",
        degree_type: "",
        start_date: "2022-09",
        end_date: "2026-06",
        gpa: "",
        cet4_score: "",
        cet6_score: "",
        courses: "",
        achievements: "",
      },
    ],
    experiences: [],
    campus_experiences: [],
    projects: [],
    skills: [{ name: "Python", level: "熟练" }],
    awards: [],
    warnings: [],
    parse_engine: "local",
    recognized_text: "",
    ...overrides,
  };
}

describe("profileToReviewRows", () => {
  it("空值不出行，列表字段拍平到子字段级", () => {
    const rows = profileToReviewRows(makeParsed());

    // 标量：只有非空的才出现。
    expect(rows.some((row) => row.id === "name")).toBe(true);
    expect(rows.some((row) => row.id === "target_city")).toBe(false);
    // 列表：一行一个值（用户能只改「专业」而保留「学校」）。
    expect(rows.filter((row) => row.section === "教育经历").map((row) => row.id)).toEqual([
      "educations.0.school",
      "educations.0.department",
      "educations.0.major",
      "educations.0.degree",
      "educations.0.start_date",
      "educations.0.end_date",
    ]);
    // 长文本用多行。
    expect(rows.find((row) => row.id === "summary")?.multiline).toBe(true);
  });

  it("分区标题复用资料页的分区名（不是另起一套叫法）", () => {
    const rows = profileToReviewRows(makeParsed());

    expect(rows.find((row) => row.id === "name")?.section).toBe("基本信息");
    expect(rows.find((row) => row.id === "summary")?.section).toBe("个人总结 / 自我评价");
    expect(rows.find((row) => row.id === "skills.0.name")?.section).toBe("专业技能");
  });
});

describe("reviewRowsToProfile", () => {
  it("什么都不改时返回空对象（往返无损）", () => {
    const parsed = makeParsed();

    const patch = reviewRowsToProfile(profileToReviewRows(parsed), parsed);

    expect(patch).toEqual({});
  });

  it("只回传改过的那一个值，且不丢条目上的其它字段", () => {
    const parsed = makeParsed();
    const rows = profileToReviewRows(parsed).map((row) =>
      row.id === "educations.0.major" ? { ...row, value: "计算机科学" } : row,
    );

    const patch = reviewRowsToProfile(rows, parsed);

    expect(Object.keys(patch)).toEqual(["educations"]);
    // 同一条教育经历的学校没被丢掉（只改专业不该把整条重建成"只有专业"）。
    expect(patch.educations?.[0]).toMatchObject({
      school: "示例大学",
      major: "计算机科学",
      department: "计算机学院",
    });
  });

  it("标量字段改名后进入补丁，未改的字段一个都不出现", () => {
    const parsed = makeParsed();
    const rows = profileToReviewRows(parsed).map((row) =>
      row.id === "name" ? { ...row, value: "王五" } : row,
    );

    expect(reviewRowsToProfile(rows, parsed)).toEqual({ name: "王五" });
  });

  it("网申侧的新字段行不由这个适配器处理（它们走 CUSTOM_ 那条链路）", () => {
    const parsed = makeParsed();
    const rows = [
      ...profileToReviewRows(parsed),
      {
        id: "CUSTOM_是否有驾照",
        section: "待确认的新字段",
        label: "是否有驾照",
        value: "C1",
        isNew: true,
        selected: true,
      },
    ];

    expect(reviewRowsToProfile(rows, parsed)).toEqual({});
  });
});
