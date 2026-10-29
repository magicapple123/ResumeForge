// SPDX-License-Identifier: Apache-2.0
/**
 * 分页芯片的名字来源：W4 七个分区 + skills 都要能出 label。
 *
 * 这一组钉住一个真实发生过的 P1：宿主曾只用 W4 的清单（`FIELD_LAYOUT_SECTIONS` 七项、
 * 不含 skills）取名，技能条目因此显示成「已删除的条目」。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types";
import { paginationEntryOptions } from "./paginationEntryLabels";

/** 造一份最小正文（正文允许旧版/半成品形状，所以按 unknown 断言进来）。 */
function content(overrides: Record<string, unknown> = {}): ResumeContent {
  return {
    photo: "",
    name: "",
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
  } as unknown as ResumeContent;
}

describe("paginationEntryOptions", () => {
  it("W4 的七个分区与 skills 都能出 label（skills 不能漏）", () => {
    const options = paginationEntryOptions(
      content({
        education: [{ id: "edu_12345678", school: "示例大学" }],
        experience: [{ id: "exp_12345678", company: "Acme", role: "Intern" }],
        projects: [{ id: "prj_12345678", name: "Atlas" }],
        awards: [{ id: "awd_12345678", name: "一等奖" }],
        publications: [{ id: "pub_12345678", title: "A Paper" }],
        skills: [{ id: "skl_12345678", name: "TypeScript" }],
      }),
    );
    const byId = Object.fromEntries(options.map((item) => [item.id, item.label]));
    expect(byId).toEqual({
      edu_12345678: "示例大学",
      exp_12345678: "Acme",
      prj_12345678: "Atlas",
      awd_12345678: "一等奖",
      pub_12345678: "A Paper",
      skl_12345678: "TypeScript",
    });
  });

  it("skills 没有 name 时退回 #序号，不留空芯片", () => {
    const options = paginationEntryOptions(
      content({ skills: [{ id: "skl_12345678", name: "" }, { id: "skl_87654321" }] }),
    );
    expect(options).toEqual([
      { id: "skl_12345678", label: "#1" },
      { id: "skl_87654321", label: "#2" },
    ]);
  });

  it("没有 id / id 形状不合法的条目一律跳过", () => {
    const options = paginationEntryOptions(
      content({
        skills: [
          { name: "无 id" },
          { id: "short", name: "太短" },
          { id: 42, name: "不是字符串" },
          { id: "skl_12345678", name: "TypeScript" },
        ],
      }),
    );
    expect(options).toEqual([{ id: "skl_12345678", label: "TypeScript" }]);
  });

  it("重复 id 去重，且先到的赢（W4 的 label 优先于 skills 补的那条）", () => {
    const options = paginationEntryOptions(
      content({
        skills: [{ id: "skl_12345678", name: "TypeScript" }],
        projects: [{ id: "skl_12345678", name: "同一 id 出现在别处" }],
      }),
    );
    expect(options).toEqual([{ id: "skl_12345678", label: "同一 id 出现在别处" }]);
  });

  it("null / undefined 输入返回空数组", () => {
    expect(paginationEntryOptions(null)).toEqual([]);
    expect(paginationEntryOptions(undefined)).toEqual([]);
  });
});
