// SPDX-License-Identifier: Apache-2.0
/** W16 真实响应 → 界面模型的纯映射：候选、blocked、采纳/撤销 items、术语。 */
import { describe, expect, it } from "vitest";
import {
  adoptItems,
  buildTranslationCandidates,
  displayTokens,
  glossaryOutToTerm,
  isSameContent,
  sameLanguage,
  termToCreatePayload,
  undoItems,
  variantToLanguageVariant,
} from "./real";
import type { VariantDetailOut } from "./api";
import type { GlossaryTerm } from "./types";

const ORIGINAL = {
  basic_info: { name: "张三" },
  summary: "负责后端服务开发与性能优化。",
  experience: [
    { company: "云商科技", role: "后端工程师", description: "把接口响应时间降了一半。" },
  ],
};

const TRANSLATED = {
  basic_info: { name: "Zhang San" },
  summary: "Built and optimized backend services.",
  experience: [
    {
      company: "Cloud Commerce",
      role: "Backend Engineer",
      description: "Cut API latency by half.",
    },
  ],
};

describe("variantToLanguageVariant", () => {
  it("brief 与 detail 都能映射；排版从 render_context 兜底", () => {
    const out = variantToLanguageVariant({
      id: 3,
      resume_id: 5,
      name: "英文版",
      language: "en-US",
      variant_group_id: 1,
      template: "classic",
      page_limit: 2,
      font_scale: "standard",
      created_at: "2026-10-01T00:00:00Z",
      content: {},
      render_context: { template: "modern", page_limit: 1, font_scale: "large" },
    } as VariantDetailOut);
    expect(out.template).toBe("modern");
    expect(out.page_limit).toBe(1);
    expect(out.language).toBe("en-US");
  });
});

describe("术语映射", () => {
  it("未知 category 收窄为 term；新建请求补语言对", () => {
    const term = glossaryOutToTerm({
      id: 1,
      source_term: "云商科技",
      target_term: "Cloud Commerce",
      language_from: "zh-CN",
      language_to: "en-US",
      category: "weird",
      locked: true,
      note: "",
    } as unknown as GlossaryTerm);
    expect(term.category).toBe("term");
    expect(termToCreatePayload({ ...term, category: "company" }, "zh-CN", "en-US")).toMatchObject({
      language_from: "zh-CN",
      language_to: "en-US",
      category: "company",
    });
  });
});

describe("翻译候选", () => {
  it("只列真变了的字段，被 blocked_fields 或事实锁保护的不可采纳", () => {
    const candidates = buildTranslationCandidates(ORIGINAL, TRANSLATED, ["basic_info.name"]);
    const byPath = new Map(candidates.map((item) => [item.path, item]));
    expect(byPath.get("summary")?.after).toBe("Built and optimized backend services.");
    expect(byPath.get("summary")?.blocked).toBe(false);
    // 姓名由事实锁保护：即便内容变了也不可采纳（并且不产生 candidate 或标记 blocked）。
    expect(byPath.get("basic_info.name")?.blocked ?? true).toBe(true);
    // 没有变化的路径不出现。
    expect(candidates.every((item) => item.before !== item.after)).toBe(true);
  });

  it("displayTokens：空侧只补 added，两侧都有用 removed+added", () => {
    expect(displayTokens("", "hello")).toEqual([{ type: "added", text: "hello" }]);
    expect(displayTokens("旧", "")).toEqual([{ type: "unchanged", text: "旧" }]);
    expect(displayTokens("旧", "新").map((item) => item.type)).toEqual(["removed", "added"]);
  });
});

/**
 * 真实 content 形状（`ResumeContent`）：education 是对象数组，courses 是字符串数组。
 *
 * 下面几条用例专门钉住 2026-11 的采纳失败：候选路径必须带数组下标
 * （`education.0.courses.1`），提交整条数组路径时后端会把整批请求拒掉。
 */
const REAL_ORIGINAL = {
  name: "张三",
  summary: "负责后端服务开发与性能优化。",
  education: [{ school: "某大学", major: "计算机", courses: ["甲", "乙"] }],
  experience: [],
  projects: [],
  campus_experience: [],
  skills: [],
  awards: [],
};

/** 只把 courses 的第 2 条换成译文，其它字段一字不动。 */
const REAL_TRANSLATED = {
  ...REAL_ORIGINAL,
  education: [{ school: "某大学", major: "计算机", courses: ["甲", "Second"] }],
};

describe("数组字段的翻译候选（真实 content 形状）", () => {
  it("按元素下标展开：只有改了的 courses[1] 出现，采纳路径带 .1", () => {
    const candidates = buildTranslationCandidates(REAL_ORIGINAL, REAL_TRANSLATED, []);
    const paths = candidates.map((item) => item.path);
    // 整条数组路径不能出现：后端读到 list 就会整批拒绝。
    expect(paths).not.toContain("education.0.courses");
    expect(paths.filter((path) => path.startsWith("education.0.courses"))).toEqual([
      "education.0.courses.1",
    ]);
    expect(adoptItems(candidates, paths)).toEqual([
      { path: "education.0.courses.1", text: "Second" },
    ]);
  });

  it("blocked 支持条目级前缀：education.0 覆盖它下面的每条子路径", () => {
    const candidates = buildTranslationCandidates(REAL_ORIGINAL, REAL_TRANSLATED, ["education.0"]);
    const item = candidates.find((candidate) => candidate.path === "education.0.courses.1");
    expect(item?.blocked).toBe(true);
  });

  it("数组项的标签按「板块 + 字段名」反查，不回落成个人总结", () => {
    const candidates = buildTranslationCandidates(REAL_ORIGINAL, REAL_TRANSLATED, []);
    const item = candidates.find((candidate) => candidate.path === "education.0.courses.1");
    expect(item?.labelKey).toBe("bilingual.field.courses");
  });
});

describe("isSameContent", () => {
  it("同源内容（仍是原样副本）判为相同；改过字段或整体为空则不同", () => {
    expect(isSameContent(REAL_ORIGINAL, { ...REAL_ORIGINAL })).toBe(true);
    expect(isSameContent(REAL_ORIGINAL, REAL_TRANSLATED)).toBe(false);
    expect(isSameContent(null, null)).toBe(false);
    expect(isSameContent({}, {})).toBe(false);
  });
});

describe("采纳 / 撤销 items", () => {
  it("只提交选中、未 blocked 且有文本的路径", () => {
    const candidates = [
      { path: "summary", labelKey: "k", before: "旧", after: "new", tokens: [], blocked: false },
      {
        path: "basic_info.name",
        labelKey: "k",
        before: "张三",
        after: "Zhang",
        tokens: [],
        blocked: true,
      },
      {
        path: "experience.0.company",
        labelKey: "k",
        before: "云商",
        after: "Cloud",
        tokens: [],
        blocked: false,
      },
    ];
    expect(adoptItems(candidates, ["summary", "basic_info.name", "experience.0.company"])).toEqual([
      { path: "summary", text: "new" },
      { path: "experience.0.company", text: "Cloud" },
    ]);
  });

  it("撤销用采纳前的旧文本、只回退实际写入的路径", () => {
    const candidates = [
      { path: "summary", labelKey: "k", before: "旧", after: "new", tokens: [], blocked: false },
      {
        path: "experience.0.company",
        labelKey: "k",
        before: "云商",
        after: "Cloud",
        tokens: [],
        blocked: false,
      },
    ];
    expect(undoItems(candidates, ["summary"]).map((item) => [item.path, item.text])).toEqual([
      ["summary", "旧"],
    ]);
  });

  it("sameLanguage 判断同语言不重复翻译", () => {
    expect(sameLanguage("zh-CN", "zh-CN")).toBe(true);
    expect(sameLanguage("zh-CN", "en-US")).toBe(false);
  });
});
