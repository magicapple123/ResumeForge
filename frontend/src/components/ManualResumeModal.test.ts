// SPDX-License-Identifier: Apache-2.0
/**
 * 新建弹窗的**唯一适配层**（v2）：`projectionToResumeDocument` 只做岗位意向覆盖。
 *
 * 字段映射、承载区「标签：值」、语言→技能、自建分区全部由服务端投影生成；前端任何
 * 二次加工都会产生"填充链路"与"生成链路"两份真相（R-37 单一来源）。这里钉住：
 * 正文（v2 section/entry/item）原样透传、只覆盖 header 的 subtitle item、空白内容不多键。
 */
import { describe, expect, it } from "vitest";
import type { ResumeDocument } from "../types/resumeDocument";
import { projectionOf } from "../test/profileProjectionFixture";
import type { Job } from "../types";
import { projectionToResumeDocument } from "../utils/profileToResume";

const JOB = { id: 8, title: "AI 应用客户端开发工程师" } as Job;

function projection() {
  return projectionOf({
    content: {
      name: "张三",
      job_intent: "旧求职意向",
      summary: "个人总结",
      education: [
        {
          school: "示例大学",
          major: "软件工程",
          degree: "本科",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "",
          courses: ["数据结构", "操作系统"],
          achievements: [],
        },
      ],
      projects: [
        {
          name: "ResumeForge",
          role: "开发者",
          start_date: "2026.01",
          end_date: "至今",
          tech_stack: ["React", "FastAPI"],
          description: ["实现简历编辑"],
          highlights: ["支持岗位适配"],
        },
      ],
      skills: [{ name: "TypeScript", level: "熟练" }],
    },
  });
}

function sectionTitles(document: ResumeDocument): string[] {
  return document.sections.map((section) => section.key);
}

describe("projectionToResumeDocument", () => {
  it("通用模式返回规范化后的 v2 文档（正文/section 结构原样保留）", () => {
    const data = projection();
    const document = projectionToResumeDocument(data, null);
    expect(document.version).toBe(2);
    expect(sectionTitles(document)).toEqual(["education", "projects", "skills", "summary"]);
    // 正文条目不丢：教育条目里有 school/period/courses 等 item。
    const education = document.sections.find((section) => section.key === "education");
    const entry = education?.entries[0];
    const keyOf = (item: { kind: string; key?: string }) => item.key ?? "";
    expect(entry?.items.some((item) => keyOf(item) === "school")).toBe(true);
    expect(entry?.items.some((item) => keyOf(item) === "courses")).toBe(true);
  });

  it("岗位模式只覆盖 header 的求职意向（subtitle item），其余正文逐字透传", () => {
    const data = projection();
    const before = projectionToResumeDocument(data, null);
    const after = projectionToResumeDocument(data, JOB);

    const subtitleOf = (document: typeof after): string =>
      document.header.items.find((item) => item.placement === "subtitle")?.value ?? "";
    expect(subtitleOf(before)).toBe("旧求职意向");
    expect(subtitleOf(after)).toBe(JOB.title);
    // 除 header 外逐字相同：正文没有第二份字段映射。
    expect(after.sections).toEqual(before.sections);
  });

  it("岗位没有标题时退回投影里的求职意向（空串也不丢）", () => {
    const data = projection();
    const document = projectionToResumeDocument(data, { id: 1, title: "" } as Job);
    const subtitle = document.header.items.find((item) => item.placement === "subtitle");
    expect(subtitle?.value).toBe("旧求职意向");
  });
});
