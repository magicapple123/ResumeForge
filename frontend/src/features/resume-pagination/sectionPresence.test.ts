// SPDX-License-Identifier: Apache-2.0
/** 「有内容的板块」判定：只影响分页方式的派生，不改变写入范围。 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types";
import { nonEmptySectionKeys } from "./sectionPresence";

const KEYS = ["education", "experience", "projects", "skills", "awards", "summary"];

function content(overrides: Partial<ResumeContent> = {}): ResumeContent {
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
  } as ResumeContent;
}

describe("nonEmptySectionKeys", () => {
  it("只保留有内容的板块，并保持传入顺序", () => {
    const result = nonEmptySectionKeys(
      content({
        education: [{ school: "示例大学" }] as ResumeContent["education"],
        skills: [{ name: "SQL" }] as ResumeContent["skills"],
        summary: "  ",
      }),
      KEYS,
    );
    expect(result).toEqual(["education", "skills"]);
  });

  it("summary 是字符串：trim 后非空才算有内容", () => {
    expect(nonEmptySectionKeys(content({ summary: "一句话" }), ["summary"])).toEqual(["summary"]);
    expect(nonEmptySectionKeys(content({ summary: "   " }), ["summary"])).toEqual([]);
  });

  it("没有 content 时退回全部键；未知键一律不算有内容", () => {
    expect(nonEmptySectionKeys(null, KEYS)).toEqual(KEYS);
    expect(nonEmptySectionKeys(content(), ["unknown_key"])).toEqual([]);
  });
});
