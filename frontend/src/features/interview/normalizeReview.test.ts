// SPDX-License-Identifier: Apache-2.0
/**
 * 复盘数据归一化的回归：六种形状都要给出**可安全渲染**的结果。
 *
 * 真实故障：`GET /api/interview/reviews` 里有一条记录的 `analysis` 只有
 * `{"framework": "..."}`，界面读 `key_points.length` 直接抛
 * `TypeError: Cannot read properties of undefined (reading 'length')`，
 * 点「查看详情」就白屏。
 */
import { describe, expect, it } from "vitest";
import { normalizeReviewAnalysis, normalizeSuggestions } from "./normalizeReview";

describe("normalizeReviewAnalysis", () => {
  it("空对象：当作没有可展示的分析", () => {
    expect(normalizeReviewAnalysis({})).toBeNull();
  });

  it("只有 framework（真实故障那条记录）：补齐空数组，不再有 undefined", () => {
    const analysis = normalizeReviewAnalysis({ framework: "先讲背景，再讲取舍。" });
    expect(analysis).not.toBeNull();
    expect(analysis?.framework).toBe("先讲背景，再讲取舍。");
    // 这三个 .length 就是之前崩掉的地方。
    expect(analysis?.key_points).toEqual([]);
    expect(analysis?.follow_up).toEqual([]);
    expect(analysis?.pitfalls).toEqual([]);
    expect(analysis?.key_points.length).toBe(0);
  });

  it("完整对象：原样保留字段与顺序", () => {
    const analysis = normalizeReviewAnalysis({
      question: "这个项目难点怎么解决？",
      framework: "STAR",
      key_points: ["说明约束", "给出结果"],
      follow_up: ["指标怎么算的"],
      pitfalls: ["只讲过程"],
    });
    expect(analysis).toEqual({
      question: "这个项目难点怎么解决？",
      framework: "STAR",
      key_points: ["说明约束", "给出结果"],
      follow_up: ["指标怎么算的"],
      pitfalls: ["只讲过程"],
    });
  });

  it("数组元素里的脏数据被丢掉（对象 / null / 空串 / 空白串）", () => {
    const analysis = normalizeReviewAnalysis({
      framework: "框架",
      key_points: ["要点", { bad: true }, null, "", "   ", 3],
    });
    expect(analysis?.key_points).toEqual(["要点"]);
  });

  it("字符串（旧版纯文本记录）：返回 null，由调用方走 legacy 分支", () => {
    expect(normalizeReviewAnalysis("旧版纯文本复盘内容……")).toBeNull();
    // 空字符串同样不是"可展示的结构化分析"。
    expect(normalizeReviewAnalysis("")).toBeNull();
  });

  it("null / undefined / 数字 / 数组：一律 null", () => {
    expect(normalizeReviewAnalysis(null)).toBeNull();
    expect(normalizeReviewAnalysis(undefined)).toBeNull();
    expect(normalizeReviewAnalysis(42)).toBeNull();
    expect(normalizeReviewAnalysis(["framework"])).toBeNull();
  });

  it("非字符串的字符串字段退化为空串，不会渲染出 [object Object]", () => {
    const analysis = normalizeReviewAnalysis({ framework: { text: "x" }, key_points: ["要点"] });
    expect(analysis?.framework).toBe("");
    expect(analysis?.question).toBe("");
  });
});

describe("normalizeSuggestions", () => {
  it("非数组：空列表（历史记录里可能根本没有 suggestions 字段）", () => {
    expect(normalizeSuggestions(undefined)).toEqual([]);
    expect(normalizeSuggestions(null)).toEqual([]);
    expect(normalizeSuggestions({})).toEqual([]);
    expect(normalizeSuggestions("high")).toEqual([]);
  });

  it("缺 evidence 的建议：补成空数组，避免 item.evidence.length 崩", () => {
    const [suggestion] = normalizeSuggestions([
      { priority: "high", section: "项目经历", issue: "不够量化", suggestion: "补充指标" },
    ]);
    expect(suggestion.evidence).toEqual([]);
    expect(suggestion.evidence.length).toBe(0);
    expect(suggestion.suggestion).toBe("补充指标");
  });

  it("字段缺失或类型不对：退化为空串 / low，不丢这一条", () => {
    const [suggestion] = normalizeSuggestions([{ evidence: ["追问了指标口径", 5] }]);
    expect(suggestion).toEqual({
      priority: "low",
      section: "",
      issue: "",
      suggestion: "",
      evidence: ["追问了指标口径"],
    });
  });

  it("数组里的非对象元素被跳过，已知档位原样保留", () => {
    const result = normalizeSuggestions([
      "不是对象",
      null,
      {
        priority: "medium",
        section: "教育",
        issue: "缺时间",
        suggestion: "补时间段",
        evidence: [],
      },
      { priority: "urgent", section: "技能", issue: "太杂", suggestion: "收敛", evidence: [] },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].priority).toBe("medium");
    expect(result[1].priority).toBe("low");
    expect(result[1].section).toBe("技能");
  });
});
