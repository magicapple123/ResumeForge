// SPDX-License-Identifier: Apache-2.0
/**
 * F4 §5.4：候选只来自**当前组投影的 candidates**，「追加这一条」按 paper_content_path
 * 取 content 现成条目——不按标题猜、不在前端重拼承载区。
 */
import { describe, expect, it } from "vitest";
import { editorSchema, editorSection } from "../../test/editorSchemaFixture";
import { projectionOf } from "../../test/profileProjectionFixture";
import type { PaperProjectionOut } from "../profile-library/types";
import { buildProfileFillSources, projectionSectionFill } from "./profileFillOptions";

function projection(): PaperProjectionOut {
  const data = projectionOf({
    keys: ["basic_info", "educations", "experiences", "projects", "skills", "awards", "summary"],
    content: {
      name: "张三",
      job_intent: "前端开发",
      summary: "  三年后端开发经验。  ",
      education: [
        {
          school: "示例大学",
          major: "软件工程",
          degree: "本科",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "",
          courses: [],
          achievements: [],
        },
      ],
      experience: [
        {
          company: "示例科技",
          role: "前端实习生",
          start_date: "2025.03",
          end_date: "2025.08",
          description: ["负责组件库"],
        },
      ],
      projects: [
        {
          name: "ResumeForge",
          role: "负责人",
          start_date: "2026.01",
          end_date: "2026.06",
          tech_stack: ["React"],
          description: ["实现编辑器"],
          highlights: [],
        },
      ],
      skills: [{ name: "TypeScript", level: "熟练" }],
      awards: [{ name: "一等奖学金", date: "2024.10", description: "" }],
    },
  });
  // 语言能力 2026-10 起独立成栏（任务 #9：也进条目级候选）。
  return {
    ...data,
    content: {
      ...data.content,
      languages: [{ name: "英语", level: "CET-6 · 550" }],
    },
    candidates: [
      ...data.candidates,
      {
        section_key: "languages",
        section_name: "语言能力",
        entry_id: "entry-languages-0",
        title: "英语",
        subtitle: "CET-6 · 550",
        paper_content_path: "languages/0",
      },
      {
        section_key: "custom:open",
        section_name: "开源贡献",
        entry_id: "entry-custom-0",
        title: "开源贡献",
        subtitle: "开源贡献",
        paper_content_path: "custom_sections/custom:open/entries/0",
      },
    ],
  };
}

describe("buildProfileFillSources（投影输入）", () => {
  it("候选 value 直接是投影 content 里的现成条目（同引用，不复制/不重映射）", () => {
    const data = projection();
    const sources = buildProfileFillSources(data);
    expect(sources.education).toHaveLength(1);
    expect(sources.education[0].value).toBe(data.content.education[0]);
    expect(sources.experience[0].value).toBe(data.content.experience[0]);
    expect(sources.projects[0].value).toBe(data.content.projects[0]);
    expect(sources.skills[0].value).toBe(data.content.skills[0]);
    expect(sources.awards[0].value).toBe(data.content.awards[0]);
  });

  it("候选身份 = entry_id，matchKey = 形状键（两者用途不同）", () => {
    const sources = buildProfileFillSources(projection());
    expect(sources.education[0].key).toBe("entry-educations-0");
    expect(sources.education[0].matchKey).toBe("示例大学|软件工程|2023.09|2027.06");
    // 标签/说明是服务端候选的 title/subtitle，前端不重算
    expect(sources.education[0].label).toBe("示例大学");
    expect(sources.education[0].hint).toBe("软件工程 · 本科 · 2023.09 ~ 2027.06");
  });

  it("语言能力也进条目级候选（任务 #9）；自建分区没有字段级来源，不提供候选", () => {
    const data = projection();
    const sources = buildProfileFillSources(data);
    expect(sources.languages).toHaveLength(1);
    expect(sources.languages?.[0].value).toBe(data.content.languages?.[0]);
    // 自建板块的正文是 {text, lines}，没有"字段"可只填空字段：不给候选，也不伪造。
    expect(projectionSectionFill(data, "custom:open")).toBeNull();
    expect(sources.publications).toEqual([]);
  });

  it("扩展分区（科研/证照/语言）也有映射；summary 来自 content（去首尾空白）", () => {
    const data = projection();
    const sources = buildProfileFillSources(data);
    expect(sources.summary).toBe("三年后端开发经验。");
    expect(projectionSectionFill(data, "publications")?.contentField).toBe("publications");
    expect(projectionSectionFill(data, "credentials")?.contentField).toBe("credentials");
    expect(projectionSectionFill(data, "basic_info")).toBeNull();
    expect(projectionSectionFill(data, "projects")?.items).toHaveLength(1);
  });

  it("没有 candidates 的分区是空数组（不按 content 硬造候选）", () => {
    const data = projection();
    const withoutCandidates = { ...data, candidates: [] };
    const sources = buildProfileFillSources(withoutCandidates);
    expect(sources.education).toEqual([]);
    expect(sources.experience).toEqual([]);
    expect(sources.projects).toEqual([]);
    expect(sources.skills).toEqual([]);
    expect(sources.awards).toEqual([]);
    expect(sources.publications).toEqual([]);
    expect(sources.languages).toEqual([]);
    expect(sources.summary).toBe("三年后端开发经验。");
  });
});

describe("编辑器视图（F10）", () => {
  it("投影带 editor_schema 时候选对象同时携带冻结视图（板块清单 + 字段）", () => {
    const data = projection();
    const schema = editorSchema(
      editorSection("basic_info", "basic", ["name"], { form: "singleton", resume_field: null }),
      editorSection("custom:22333", "22333", [], { resume_field: "custom_sections" }),
    );
    const sources = buildProfileFillSources({ ...data, editor_schema: schema });
    expect(sources.editorView?.sections.map((section) => section.key)).toEqual([
      "basic_info",
      "custom:22333",
    ]);
    expect(sources.editorView?.schema).toBe(schema);
  });

  it("没有 editor_schema（旧后端/旧夹具）时不带视图：页签退回旧行为", () => {
    expect(buildProfileFillSources(projection()).editorView).toBeUndefined();
  });
});
