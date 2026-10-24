// SPDX-License-Identifier: Apache-2.0
/**
 * 科研页签装配出口（W14）：wb-core 依赖的三个契约。
 *
 * 1. key 必须等于 content 字段名（纸面点击靠它映射回页签）；
 * 2. 页签顺序固定（论文 → 科研项目 → 专利）；
 * 3. label 是**已翻译**的值，不是 key 本身（否则挂上去就是一串英文 key）。
 */
import { describe, expect, it } from "vitest";
import { RESEARCH_TAB_KEYS, researchTabItems } from "./ResearchTabs";
import { rt } from "../../../features/resume-research/i18n";

describe("researchTabItems", () => {
  it("三个页签的 key 与 content 字段名逐字一致", () => {
    expect([...RESEARCH_TAB_KEYS]).toEqual(["publications", "research_projects", "patents"]);
    expect(researchTabItems().map((item) => item?.key)).toEqual([...RESEARCH_TAB_KEYS]);
  });

  it("label 是翻译值而不是 key，且每个页签都有内容", () => {
    const items = researchTabItems();
    const expected = [
      rt("research.tab.publications"),
      rt("research.tab.projects"),
      rt("research.tab.patents"),
    ];
    expect(items.map((item) => item?.label)).toEqual(expected);
    for (const item of items) {
      expect(item?.label).not.toBe(item?.key);
      expect(item?.children).toBeTruthy();
    }
  });
});
