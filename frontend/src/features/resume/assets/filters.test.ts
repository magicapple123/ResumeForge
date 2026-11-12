// SPDX-License-Identifier: Apache-2.0
/**
 * 资产库纯规则（W17）：筛选 / 排序 / 标签聚合 / 生效筛选计数。
 *
 * 这些规则是"输入即筛"的唯一实现（组件不再自己写 `includes`），所以用例覆盖到边界：
 * 空关键词、大小写、标签命中、未标注语言、排序稳定性、默认筛选判定。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHRASE_FILTER,
  activeFilterCount,
  collectLanguages,
  collectTags,
  filterPhrases,
  isDefaultFilter,
  matchesKeyword,
  normalizeFilter,
  sortPhrases,
  visiblePhrases,
} from "./filters";
import type { ResumePhrase } from "./types";

function phrase(overrides: Partial<ResumePhrase>): ResumePhrase {
  return {
    id: 1,
    text: "Built a thing",
    kind: "achievement",
    language: "en-US",
    job_tags: [],
    source_claim_id: null,
    source_resume_id: null,
    source_object_id: null,
    quality_note: "",
    usage_count: 0,
    last_used_at: null,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const ITEMS: ResumePhrase[] = [
  phrase({
    id: 1,
    text: "Cut latency by 60%",
    job_tags: ["backend"],
    usage_count: 5,
    last_used_at: "2026-10-20T00:00:00Z",
  }),
  phrase({
    id: 2,
    text: "Led design reviews",
    kind: "method",
    job_tags: ["collaboration"],
    usage_count: 2,
    last_used_at: "2026-10-10T00:00:00Z",
  }),
  phrase({
    id: 3,
    text: "Owned on-call",
    kind: "result",
    language: "",
    job_tags: ["backend", "sre"],
    usage_count: 9,
    last_used_at: null,
  }),
];

describe("normalizeFilter / 生效计数", () => {
  it("未知值落回默认、关键词去空白", () => {
    expect(normalizeFilter({ keyword: "  backend  " })).toMatchObject({
      keyword: "backend",
      kind: "all",
      language: "all",
      tag: "all",
      sort: "recent",
    });
    expect(normalizeFilter({ sort: "bogus" as never }).sort).toBe("recent");
    expect(normalizeFilter(null)).toEqual(DEFAULT_PHRASE_FILTER);
  });

  it("只有筛选维度计数，排序不算", () => {
    expect(activeFilterCount(DEFAULT_PHRASE_FILTER)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_PHRASE_FILTER, sort: "usage" })).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_PHRASE_FILTER,
        keyword: "x",
        kind: "method",
        language: "",
        tag: "sre",
      }),
    ).toBe(4);
    expect(isDefaultFilter(DEFAULT_PHRASE_FILTER)).toBe(true);
    expect(isDefaultFilter({ ...DEFAULT_PHRASE_FILTER, kind: "method" })).toBe(false);
  });
});

describe("matchesKeyword / filterPhrases", () => {
  it("关键词同时匹配正文与岗位标签，大小写不敏感", () => {
    expect(matchesKeyword(ITEMS[0], "LATENCY")).toBe(true);
    expect(matchesKeyword(ITEMS[0], "back")).toBe(true);
    expect(matchesKeyword(ITEMS[0], "design")).toBe(false);
    expect(matchesKeyword(ITEMS[0], "   ")).toBe(true);
  });

  it("按类型 / 语言 / 标签组合筛选", () => {
    expect(
      filterPhrases(ITEMS, { ...DEFAULT_PHRASE_FILTER, kind: "method" }).map((p) => p.id),
    ).toEqual([2]);
    expect(
      filterPhrases(ITEMS, { ...DEFAULT_PHRASE_FILTER, language: "" }).map((p) => p.id),
    ).toEqual([3]);
    expect(
      filterPhrases(ITEMS, { ...DEFAULT_PHRASE_FILTER, tag: "backend" }).map((p) => p.id),
    ).toEqual([1, 3]);
    expect(
      filterPhrases(ITEMS, { ...DEFAULT_PHRASE_FILTER, tag: "backend", keyword: "latency" }).map(
        (p) => p.id,
      ),
    ).toEqual([1]);
  });
});

describe("sortPhrases / visiblePhrases", () => {
  it("按使用次数降序；同频按 id 降序", () => {
    expect(sortPhrases(ITEMS, "usage").map((p) => p.id)).toEqual([3, 1, 2]);
  });

  it("按最近使用降序；从未使用的排在最后", () => {
    expect(sortPhrases(ITEMS, "recent").map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("筛选 + 排序由同一出口给出", () => {
    const result = visiblePhrases(ITEMS, {
      ...DEFAULT_PHRASE_FILTER,
      tag: "backend",
      sort: "created",
    });
    expect(result.map((p) => p.id)).toEqual([3, 1]);
  });

  it("不修改入参数组", () => {
    const source = ITEMS.slice();
    sortPhrases(source, "usage");
    expect(source.map((p) => p.id)).toEqual([1, 2, 3]);
  });
});

describe("collectTags / collectLanguages", () => {
  it("标签按出现次数降序，同频字典序", () => {
    expect(collectTags(ITEMS)).toEqual(["backend", "collaboration", "sre"]);
  });

  it("语言含未标注（空串）且排序稳定", () => {
    expect(collectLanguages(ITEMS)).toEqual(["", "en-US"]);
  });
});
