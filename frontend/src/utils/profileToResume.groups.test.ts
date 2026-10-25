// SPDX-License-Identifier: Apache-2.0
/**
 * F4 §5.3：资料 → 简历正文的适配层**只做岗位意向覆盖**。
 *
 * 字段映射、承载区「标签：值」、语言→技能、自建分区全部由服务端投影生成；前端任何
 * 二次加工都会产生"填充链路"与"生成链路"两份真相（R-37 单一来源）。这里钉住：
 * 正文对象原样透传、可选栏目（credentials/custom_sections）往返不丢、空白内容不多键。
 */
import { describe, expect, it } from "vitest";
import { projectionOf } from "../test/profileProjectionFixture";
import type { Job, ResumeContent } from "../types";
import {
  blankResumeContent,
  hasAnyResumeContent,
  projectionToResumeContent,
} from "./profileToResume";

const JOB = { id: 3, title: "前端开发工程师" } as Job;

function projection() {
  return projectionOf({
    content: {
      name: "张三",
      phone: "13800000000",
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
          courses: [],
          achievements: [],
        },
      ],
    },
  });
}

describe("projectionToResumeContent", () => {
  it("通用模式直接返回服务端 content（整份填充 = 确定性纸面内容）", () => {
    const data = projection();
    expect(projectionToResumeContent(data, null)).toBe(data.content);
  });

  it("岗位模式只改 job_intent，正文对象原样透传", () => {
    const data = projection();
    const result = projectionToResumeContent(data, JOB);
    expect(result.job_intent).toBe(JOB.title);
    expect(result.education).toBe(data.content.education);
    expect(result.custom_sections).toBe(data.content.custom_sections);
  });

  it("岗位没有标题时退回投影里的求职意向", () => {
    const data = projection();
    expect(projectionToResumeContent(data, { id: 1, title: "" } as Job).job_intent).toBe(
      "旧求职意向",
    );
  });

  it("服务端已有的 credentials / custom_sections 原样保留（不丢段）", () => {
    const data = projection();
    const content: ResumeContent = {
      ...data.content,
      credentials: [
        {
          name: "CET-6",
          issuer: "教育部",
          issue_date: "2024.06",
          expiry_date: "",
          status: "active",
          verify_url: "",
          note: "",
        },
      ],
      custom_sections: [
        {
          key: "custom:open-source",
          title: "开源贡献",
          entries: [
            { entry_id: "e1", text: "维护插件生态", lines: [{ label: "角色", value: "维护者" }] },
          ],
        },
      ],
    };
    const result = projectionToResumeContent({ ...data, content }, JOB);
    expect(result.credentials).toBe(content.credentials);
    expect(result.custom_sections).toBe(content.custom_sections);
  });
});

describe("blankResumeContent / hasAnyResumeContent", () => {
  it("空白内容不凭空产生可选栏目的空数组键（旧简历指纹口径不变）", () => {
    const blank = blankResumeContent();
    for (const key of ["credentials", "custom_sections", "publications"]) {
      expect(key in blank).toBe(false);
    }
    expect(hasAnyResumeContent(blank)).toBe(false);
  });

  it("自建分区/证照有内容时也算「有内容」（覆盖确认不会漏拦）", () => {
    const withCustom: ResumeContent = {
      ...blankResumeContent(),
      custom_sections: [
        {
          key: "custom:x",
          title: "开源贡献",
          entries: [{ entry_id: "e1", text: "维护插件", lines: [] }],
        },
      ],
    };
    expect(hasAnyResumeContent(withCustom)).toBe(true);
  });
});
