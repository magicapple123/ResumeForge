// SPDX-License-Identifier: Apache-2.0
/** 「板块顺序」浮层的可见集合（#5）：只列有内容的板块；自建板块只读列出。 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types/resume";
import { customSectionRows, moveVisibleSection, presentSectionKeys } from "./sectionPresence";

const OPTIONS = [
  { key: "education", label: "Education" },
  { key: "projects", label: "Projects" },
  { key: "skills", label: "Skills" },
  { key: "summary", label: "Summary" },
];

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

describe("sectionPresence", () => {
  it("只把有内容的系统板块算作 present；content 缺省返回 null", () => {
    const c = content({
      education: [{ school: "S" } as never],
      summary: "hello",
      skills: [],
    });
    expect([...presentSectionKeys(c, OPTIONS)!].sort()).toEqual(["education", "summary"]);
    expect(presentSectionKeys(null, OPTIONS)).toBeNull();
  });

  it("空字符串与空数组都不算有内容", () => {
    const c = content({ summary: "   ", education: [] });
    expect(presentSectionKeys(c, OPTIONS)!.size).toBe(0);
  });

  it("自建板块只返回有内容的，标题沿用正文", () => {
    const c = content({
      custom_sections: [
        { key: "custom:a", title: "A", entries: [{ entry_id: "e1", text: "x", lines: [] }] },
        { key: "custom:b", title: "B", entries: [{ entry_id: "e2", text: "", lines: [] }] },
      ],
    } as never);
    expect(customSectionRows(c)).toEqual([{ key: "custom:a", title: "A" }]);
  });

  it("移动只交换可见板块在完整顺序里的位置，空板块位置保留", () => {
    const full = ["education", "projects", "skills", "summary"];
    const visible = ["education", "summary"];
    expect(moveVisibleSection(full, visible, "education", 1)).toEqual([
      "summary",
      "projects",
      "skills",
      "education",
    ]);
    expect(moveVisibleSection(full, visible, "education", -1)).toBeNull();
  });
});
