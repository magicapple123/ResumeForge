// SPDX-License-Identifier: Apache-2.0
/** W16 真实响应 → 界面模型的纯映射（v2）：版本摘要、正文收口、术语表、内容一致性。 */
import { describe, expect, it } from "vitest";
import {
  glossaryOutToTerm,
  isSameContent,
  sameLanguage,
  termToCreatePayload,
  variantDocumentOf,
  variantToLanguageVariant,
} from "./real";
import { MOCK_PRIMARY } from "../../test/bilingualMock";
import type { GlossaryTerm } from "./types";
import type { VariantDetailOut } from "./api";

describe("variantToLanguageVariant", () => {
  it("摘要与详情都能映射（只保留语言版本切换需要的字段）", () => {
    const brief = variantToLanguageVariant({
      id: 3,
      resume_id: 5,
      name: "English version",
      language: "en-US",
      variant_group_id: 1,
      created_at: "2026-10-01T00:00:00Z",
    });
    expect(brief).toMatchObject({ id: 3, resume_id: 5, language: "en-US" });
    const detail = variantToLanguageVariant({
      ...brief,
      content: MOCK_PRIMARY,
      created_at: "2026-10-01T00:00:00Z",
    } as VariantDetailOut);
    expect(detail.language).toBe("en-US");
  });
});

describe("variantDocumentOf", () => {
  it("只认 v2 文档；空/非 v2 返回 null（不编造结构）", () => {
    expect(variantDocumentOf({ content: MOCK_PRIMARY })).toBe(MOCK_PRIMARY);
    expect(variantDocumentOf({ content: {} as never })).toBeNull();
    expect(variantDocumentOf(null)).toBeNull();
  });
});

describe("术语映射", () => {
  it("未知 category 收窄为 term；新建请求补语言对", () => {
    const term = glossaryOutToTerm({
      id: 1,
      source_term: "Cloud Commerce",
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

describe("isSameContent", () => {
  it("两侧都有内容时按键序比较；空值不误判为一致", () => {
    expect(isSameContent(MOCK_PRIMARY, structuredClone(MOCK_PRIMARY))).toBe(true);
    const changed = structuredClone(MOCK_PRIMARY);
    const summary = changed.sections.find((section) => section.key === "summary");
    const text = summary?.entries[0]?.items.find((item) => item.kind === "text");
    if (text && text.kind === "text") text.text = "Changed.";
    expect(isSameContent(MOCK_PRIMARY, changed)).toBe(false);
    expect(isSameContent(null, MOCK_PRIMARY)).toBe(false);
    expect(isSameContent({}, MOCK_PRIMARY)).toBe(false);
  });
});

describe("sameLanguage", () => {
  it("源语言与目标语言相同即拦截", () => {
    expect(sameLanguage("en-US", "en-US")).toBe(true);
    expect(sameLanguage("zh-CN", "en-US")).toBe(false);
  });
});
