// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  diffKindsPresent,
  hasMachineText,
  highlightSegments,
  tokensFromOrderDiffs,
} from "./machineText";

describe("D11 机器读正文的 token 高亮", () => {
  it("从 order_diffs 收集 token：去重、过滤过长说明", () => {
    const tokens = tokensFromOrderDiffs([
      { kind: "missing", token: "技能", page: 1, expected_index: 0 },
      { kind: "missing", token: "技能", page: 2, expected_index: 1 },
      { kind: "garbled", token: "x".repeat(41), page: null, expected_index: null },
    ]);
    expect(tokens).toEqual([{ token: "技能", kind: "missing" }]);
  });

  it("长 token 优先匹配，切出普通/高亮交替片段", () => {
    const tokens = tokensFromOrderDiffs([
      { kind: "missing", token: "机器", page: 1, expected_index: 0 },
      { kind: "out_of_order", token: "机器学习", page: 1, expected_index: 1 },
    ]);
    const segments = highlightSegments("项目：机器学习与机器翻译", tokens);
    expect(segments).toEqual([
      { text: "项目：", kind: "normal" },
      { text: "机器学习", kind: "out_of_order" },
      { text: "与", kind: "normal" },
      { text: "机器", kind: "missing" },
      { text: "翻译", kind: "normal" },
    ]);
  });

  it("无 token 时整段普通；空文本返回空数组", () => {
    expect(highlightSegments("abc", [])).toEqual([{ text: "abc", kind: "normal" }]);
    expect(highlightSegments("", [])).toEqual([]);
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
