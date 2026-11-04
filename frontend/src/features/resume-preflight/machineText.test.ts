// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  diffKindsPresent,
  hasMachineText,
  sliceByHighlights,
  tokensFromOrderDiffs,
} from "./machineText";

describe("D11 机器读正文的区间高亮", () => {
  it("从 order_diffs 收集 token：去重、过滤过长说明", () => {
    const tokens = tokensFromOrderDiffs([
      { kind: "missing", token: "技能", page: 1, expected_index: 0 },
      { kind: "missing", token: "技能", page: 2, expected_index: 1 },
      { kind: "garbled", token: "x".repeat(41), page: null, expected_index: null },
    ]);
    expect(tokens).toEqual([{ token: "技能", kind: "missing" }]);
  });

  it("按区间切片：区间外一律普通，区间内是差异类型", () => {
    const segments = sliceByHighlights("项目：机器学习与机器翻译", [
      { page: 1, start: 3, end: 7, kind: "out_of_order" },
    ]);
    expect(segments).toEqual([
      { text: "项目：", kind: "normal" },
      { text: "机器学习", kind: "out_of_order" },
      { text: "与机器翻译", kind: "normal" },
    ]);
  });

  it("同一个片段在正文出现多次时只涂区间内那一处", () => {
    // 旧实现用 indexOf：正文里 5 个「与」会被全部涂上。现在只有区间那一个。
    const text = "甲与乙与丙与丁与戊与己";
    const segments = sliceByHighlights(text, [{ page: 1, start: 5, end: 6, kind: "out_of_order" }]);
    expect(segments.filter((segment) => segment.kind !== "normal")).toEqual([
      { text: "与", kind: "out_of_order" },
    ]);
    // 拼回去必须还是原文，一个字都不能丢。
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
  });

  it("没有区间时整段普通；空文本返回空数组", () => {
    expect(sliceByHighlights("abc", [])).toEqual([{ text: "abc", kind: "normal" }]);
    expect(sliceByHighlights("", [])).toEqual([]);
    expect(sliceByHighlights("abc", null)).toEqual([{ text: "abc", kind: "normal" }]);
  });

  it("偏移基准是码点：emoji 占 1 个偏移，不是 2 个", () => {
    // 后端按 Python 码点算：😀=0、乙=1。若这里按 UTF-16 码元切，会切到「😀乙」或空中。
    const segments = sliceByHighlights("😀乙甲", [
      { page: 1, start: 1, end: 2, kind: "out_of_order" },
    ]);
    expect(segments).toEqual([
      { text: "😀", kind: "normal" },
      { text: "乙", kind: "out_of_order" },
      { text: "甲", kind: "normal" },
    ]);
  });

  it("越界/非整数/重叠区间被丢弃，不抛错也不涂错", () => {
    const text = "abcdef";
    expect(
      sliceByHighlights(text, [
        { page: 1, start: 0, end: 4, kind: "out_of_order" },
        { page: 1, start: 2, end: 5, kind: "out_of_order" },
        { page: 1, start: 4, end: 99, kind: "out_of_order" },
        { page: 1, start: 1.5, end: 2.5, kind: "out_of_order" },
      ]),
    ).toEqual([
      { text: "abcd", kind: "out_of_order" },
      { text: "ef", kind: "normal" },
    ]);
  });

  it("图例只列出现过的差异类型；空页不算有正文", () => {
    expect(
      diffKindsPresent([
        { kind: "missing", token: "a", page: 1, expected_index: 0 },
        { kind: "out_of_order", token: "b", page: 1, expected_index: 1 },
        { kind: "missing", token: "c", page: 2, expected_index: 2 },
      ]),
    ).toEqual(["missing", "out_of_order"]);
    expect(hasMachineText([])).toBe(false);
    expect(hasMachineText([{ page: 1, text: "  " }])).toBe(false);
    expect(hasMachineText([{ page: 1, text: "hello" }])).toBe(true);
  });
});
