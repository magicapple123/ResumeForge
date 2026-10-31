// SPDX-License-Identifier: Apache-2.0
/**
 * F4 §5.3：资料投影 → v2 文档的适配层**只做岗位意向覆盖**。
 *
 * 字段映射、承载区「标签：值」、语言→技能、自建分区全部由服务端投影生成；前端任何
 * 二次加工都会产生"填充链路"与"生成链路"两份真相（R-37 单一来源）。这里钉住：
 * v2 正文原样透传、只覆盖 header 的 subtitle item、自建板块/可选栏目往返不丢。
 */
import { describe, expect, it } from "vitest";
import { projectionOf } from "../test/profileProjectionFixture";
import type { Job } from "../types";
import { projectionToResumeDocument } from "./profileToResume";

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

describe("projectionToResumeDocument", () => {
  it("通用模式：整份投影正文（v2）原样进入文档，岗位模式：只改 header 的意向 item", () => {
    const data = projection();
    const base = projectionToResumeDocument(data, null);
    const targeted = projectionToResumeDocument(data, JOB);

    expect(base.sections).toEqual(targeted.sections);
    const subtitleOf = (document: typeof base): string =>
      document.header.items.find((item) => item.placement === "subtitle")?.value ?? "";
    expect(subtitleOf(base)).toBe("旧求职意向");
    expect(subtitleOf(targeted)).toBe(JOB.title);
  });

  it("自建板块原样保留（converter 生成的 custom: 板块与条目都不丢）", () => {
    const data = projectionOf({
      content: {
        name: "张三",
        custom_sections: [
          {
            key: "custom:open-source",
            title: "开源贡献",
            entries: [
              {
                entry_id: "e1",
                text: "维护插件生态",
                lines: [{ label: "角色", value: "维护者" }],
              },
            ],
          },
        ],
      },
    });
    const document = projectionToResumeDocument(data, JOB);
    const custom = document.sections.find((section) => section.key === "custom:open-source");
    expect(custom).toBeTruthy();
    expect(custom?.title).toBe("开源贡献");
    const items = custom?.entries[0]?.items ?? [];
    expect(items.some((item) => item.kind === "text" && item.text === "维护插件生态")).toBe(true);
    // 自定义字段保持 FieldItem，标签存在 item.label 上（不是拼成「标签：值」字符串）。
    const field = items.find((item) => item.kind === "field");
    expect(field).toBeTruthy();
    if (field && field.kind === "field") expect(field.label).toBe("角色");
  });

  it("岗位没有标题时退回投影里的求职意向", () => {
    const data = projection();
    const subtitle = projectionToResumeDocument(data, {
      id: 1,
      title: "",
    } as Job).header.items.find((item) => item.placement === "subtitle");
    expect(subtitle?.value).toBe("旧求职意向");
    expect(subtitle?.value).not.toBe("");
  });
});
