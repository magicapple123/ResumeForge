// SPDX-License-Identifier: Apache-2.0
/** 语言能力空条目清理：保存前剔除"画不出来"的条目（与自建板块/科研三栏同一口径）。 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../types";
import { stripEmptyLanguages } from "./stripEmptyLanguages";

const base = (languages: ResumeContent["languages"]): ResumeContent => ({
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
  languages,
  awards: [],
});

describe("stripEmptyLanguages", () => {
  it("去掉全空条目、保留只有部分字段的条目", () => {
    const content = base([
      { name: "" },
      { name: "英语", level: "CET-6" },
      { name: "", obtained_at: "2020-06" },
    ]);
    expect(stripEmptyLanguages(content).languages).toEqual([
      { name: "英语", level: "CET-6" },
      { name: "", obtained_at: "2020-06" },
    ]);
  });

  it("没有可清理内容时返回同一个引用", () => {
    const content = base([{ name: "英语" }]);
    expect(stripEmptyLanguages(content)).toBe(content);
  });

  it("整份清空时删掉 languages 键（空数组不序列化）", () => {
    const content = base([{ name: "" }, { name: "", level: "" }]);
    expect("languages" in stripEmptyLanguages(content)).toBe(false);
  });
});
