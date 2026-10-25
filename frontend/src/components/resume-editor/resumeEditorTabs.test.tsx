// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器页签装配（F9/R1）：按当前组参与清单过滤 + 已有内容的分区保留 + 顺序。
 *
 * 纯函数级用例：不挂载组件，只回答"哪些页签、按什么顺序"。组件层行为（切组后真的
 * 重新渲染、编辑中不丢输入）在 `ManualResumeModal.blank.test.tsx` 里钉。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types";
import { makeResumeContent } from "../ResumeEditorModal.testkit";
import { buildResumeEditorTabItems, tabContentPresenceMask } from "./resumeEditorTabs";

const baseOptions = { summarySource: "", fillSummary: () => undefined };

function tabKeys(
  options: Partial<Parameters<typeof buildResumeEditorTabItems>[0]> = {},
): (string | number)[] {
  return buildResumeEditorTabItems({ ...baseOptions, ...options }).map((item) => item.key);
}

/** 编辑已保存简历时可能出现的可选栏目内容（正文里有、当前组不一定有）。 */
function contentWith(overrides: Partial<ResumeContent>): ResumeContent {
  return makeResumeContent(overrides);
}

describe("buildResumeEditorTabItems：当前组过滤（R1）", () => {
  it("没有参与清单时退回完整的规范列表（旧宿主/旧夹具不受影响）", () => {
    expect(tabKeys()).toEqual([
      "basic",
      "education",
      "experience",
      "campus",
      "projects",
      "skills",
      "awards",
      "publications",
      "research_projects",
      "patents",
      "credentials",
    ]);
  });

  it("当前组有的分区出现（即使内容为空），没有且无内容的分区不出现", () => {
    expect(
      tabKeys({
        participatingKeys: ["basic_info", "educations", "skills"],
      }),
    ).toEqual(["basic", "education", "skills"]);
  });

  it("顺序按当前组全局顺序（服务端已排好；basic 首位）", () => {
    expect(
      tabKeys({
        participatingKeys: ["basic_info", "skills", "educations", "awards"],
      }),
    ).toEqual(["basic", "skills", "education", "awards"]);
  });

  it("basic_info / summary 都映射到「基本信息」，不会重复出页签", () => {
    expect(tabKeys({ participatingKeys: ["basic_info", "summary", "educations"] })).toEqual([
      "basic",
      "education",
    ]);
  });

  it("languages 按 R-72 写入技能 → 映射到「技能」页签", () => {
    expect(tabKeys({ participatingKeys: ["basic_info", "languages"] })).toEqual([
      "basic",
      "skills",
    ]);
  });

  it("已有内容的分区永远保留页签（切组不丢已保存正文，R-34），按规范顺序补在后面", () => {
    expect(
      tabKeys({
        participatingKeys: ["basic_info"],
        content: contentWith({
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
          projects: [
            {
              name: "ResumeForge",
              role: "开发者",
              start_date: "2026.01",
              end_date: "至今",
              tech_stack: [],
              description: [],
              highlights: [],
            },
          ],
        }),
      }),
    ).toEqual(["basic", "education", "projects"]);
  });

  it("科研三栏有内容时也保留（内容字段名 = 页签 key）", () => {
    const content = {
      ...contentWith({}),
      publications: [{ title: "论文一" }],
    } as ResumeContent;
    expect(tabKeys({ participatingKeys: ["basic_info"], content })).toEqual([
      "basic",
      "publications",
    ]);
  });

  it("当前组有自建大字段 → 出现「自定义栏目」页签（即使正文还没内容，用户要能录入）", () => {
    expect(tabKeys({ participatingKeys: ["basic_info", "custom:open_source"] })).toEqual([
      "basic",
      "custom-sections",
    ]);
  });

  it("不知道当前组时沿用旧判据：正文里有自建分区才出现「自定义栏目」", () => {
    expect(tabKeys({ customSectionCount: 0 })).not.toContain("custom-sections");
    const content = {
      ...contentWith({}),
      custom_sections: [{ key: "custom:open_source", title: "开源贡献", entries: [] }],
    } as ResumeContent;
    expect(tabKeys({ content })).toContain("custom-sections");
  });

  it("表单里刚加、还没保存的分区也算内容：正文与表单值取并集后保留页签", () => {
    // 场景：当前组切走了「项目」，但用户在切组前刚往项目里加了一条（表单里有、正文快照没有）。
    const formValues = contentWith({
      projects: [
        {
          name: "还没保存的项目",
          role: "",
          start_date: "",
          end_date: "",
          tech_stack: [],
          description: [],
          highlights: [],
        },
      ],
    });
    const mask = tabContentPresenceMask(null, formValues);
    expect(tabKeys({ participatingKeys: ["basic_info"], contentPresenceMask: mask })).toEqual([
      "basic",
      "projects",
    ]);
    // 没有内容的字段掩码是 0：不会因为"表单对象一直在变"多出页签。
    expect(tabContentPresenceMask(null, contentWith({}))).toMatch(/^0+$/);
  });

  it("参与清单为空（异常投影）时至少保留基本信息页签", () => {
    expect(tabKeys({ participatingKeys: [] })).toEqual(["basic"]);
  });
});
