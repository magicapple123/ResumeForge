// SPDX-License-Identifier: Apache-2.0
/**
 * F8-C：字段级差异的标签表覆盖新增字段。
 *
 * 变更审阅按「属性名 → 中文标签」渲染；新字段没有标签时会直接显示英文属性名
 * （如 advisor），用户看不懂改了什么。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../types/resumeContent";
import { computeFieldDiff } from "./resumeFieldDiff";

function content(overrides: Record<string, unknown> = {}): ResumeContent {
  return {
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
    ...overrides,
  } as ResumeContent;
}

function modifiedLabels(base: ResumeContent, against: ResumeContent): string[] {
  const result = computeFieldDiff(base, against, "旧", "新");
  const labels: string[] = [];
  for (const section of result.changed) {
    if (section.type !== "list") continue;
    for (const item of section.modified) {
      for (const sub of item.subfields) labels.push(sub.label);
    }
  }
  return labels;
}

describe("resumeFieldDiff 新字段标签", () => {
  it("教育经历：学习形式/学位类型/院系/成绩排名/导师/研究方向有中文标签", () => {
    const base = content({ education: [{ school: "A" }] });
    const against = content({
      education: [
        {
          school: "A",
          study_form: "全日制",
          degree_type: "学术型",
          department: "计算机系",
          rank: "前 5%",
          advisor: "张伟",
          research_direction: "数据库",
        },
      ],
    });
    expect(modifiedLabels(base, against)).toEqual(
      expect.arrayContaining(["学习形式", "学位类型", "院系", "成绩排名", "导师", "研究方向"]),
    );
  });

  it("工作/项目/技能/校园/奖项：新增字段都有中文标签", () => {
    const base = content({
      experience: [{ company: "A" }],
      projects: [{ name: "P" }],
      skills: [{ name: "S" }],
      campus_experience: [{ organization: "O" }],
      awards: [{ name: "W" }],
    });
    const against = content({
      experience: [{ company: "A", team_size: "8 人", experience_kind: "internship" }],
      projects: [{ name: "P", project_size: "5 人", artifact_type: "开源作品" }],
      skills: [{ name: "S", category: "编程语言" }],
      campus_experience: [{ organization: "O", activity_type: "社团" }],
      awards: [{ name: "W", issuer: "教育部", level: "国家级", ratio: "前 1%" }],
    });
    const labels = modifiedLabels(base, against);
    expect(labels).toEqual(
      expect.arrayContaining([
        "团队规模",
        "工作类型",
        "项目规模",
        "成果类型",
        "技能分类",
        "活动类型",
        "颁发机构",
        "奖项级别",
        "获奖比例",
      ]),
    );
  });
});
