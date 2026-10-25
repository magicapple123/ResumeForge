// SPDX-License-Identifier: Apache-2.0
/**
 * 新建弹窗的**唯一适配层**：`projectionToResumeContent` 只做岗位意向覆盖，
 * 其余字段（含承载区「标签：值」、语言→技能、自建分区）一律是服务端投影的现成对象。
 */
import { describe, expect, it } from "vitest";
import { projectionOf } from "../test/profileProjectionFixture";
import type { Job } from "../types";
import {
  blankResumeContent,
  hasAnyResumeContent,
  projectionToResumeContent,
} from "../utils/profileToResume";

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

describe("projectionToResumeContent", () => {
  it("岗位模式只覆盖求职意向，其余正文原样透传（不做第二份字段映射）", () => {
    const data = projection();
    const result = projectionToResumeContent(data, JOB);

    expect(result.job_intent).toBe(JOB.title);
    // 正文全部来自服务端投影：数组字段与服务端产出的形状逐字相同，没有前端再拆分。
    expect(result.education).toBe(data.content.education);
    expect(result.education[0].courses).toEqual(["数据结构", "操作系统"]);
    expect(result.projects[0].tech_stack).toEqual(["React", "FastAPI"]);
    expect(result.skills).toEqual([{ name: "TypeScript", level: "熟练" }]);
    expect(result.summary).toBe("个人总结");
  });

  it("岗位没有标题时退回投影里的求职意向（空串也不丢）", () => {
    const data = projection();
    expect(projectionToResumeContent(data, { id: 1, title: "" } as Job).job_intent).toBe(
      "旧求职意向",
    );
    expect(projectionToResumeContent(data, { id: 1, title: "" } as Job).job_intent).not.toBe("");
  });

  it("通用模式直接返回服务端 content（整份填充 = 确定性纸面内容）", () => {
    const data = projection();
    expect(projectionToResumeContent(data, null)).toBe(data.content);
  });
});

describe("blankResumeContent / hasAnyResumeContent", () => {
  it("空白内容不凭空塞可选的科研/证照/自建分区键（旧简历指纹口径不变）", () => {
    const blank = blankResumeContent();
    for (const key of [
      "publications",
      "research_projects",
      "patents",
      "credentials",
      "custom_sections",
    ]) {
      expect(key in blank).toBe(false);
    }
    expect(hasAnyResumeContent(blank)).toBe(false);
  });

  it("可选栏目有内容时也算「有内容」（整份填充后不会被当成空表覆盖确认绕过）", () => {
    const withCustom = {
      ...blankResumeContent(),
      custom_sections: [{ key: "custom:x", title: "开源贡献", entries: [] }],
    };
    expect(hasAnyResumeContent(withCustom)).toBe(true);
    expect(
      hasAnyResumeContent({ ...blankResumeContent(), credentials: [{ name: "CET-6" }] as never }),
    ).toBe(true);
  });
});
