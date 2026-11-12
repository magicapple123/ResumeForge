// SPDX-License-Identifier: Apache-2.0
/**
 * #14B 队列排序与参考分档位的单测：纯函数，不挂 React。
 *
 * 三条约定都是"看起来无关紧要、错了就很难查"的那类：
 * 参考分 `null` 必须落在 `none` 档（不能渲染成 0 分）、排序必须稳定（否则表格会自己跳）、
 * 默认口径必须还是入队顺序（否则用户熟悉的行位置会变）。
 */
import { describe, expect, it } from "vitest";
import type { ApplyQueueItem } from "../../../types";
import { firstLine, nextSortKey, scoreBand, sortQueueItems } from "./queueSort";

function item(id: number, score: number | null | undefined): ApplyQueueItem {
  return {
    id,
    job_id: 100 + id,
    job_title: `岗位 ${id}`,
    company: "A公司",
    resume_id: null,
    resume_title: "",
    greeting: "",
    sort_order: 0,
    status: "pending",
    admission: null,
    hard_gate: null,
    requires_confirm: false,
    match_score: score,
    favorite: false,
    created_at: "2026-09-17T08:00:00",
    updated_at: "2026-09-17T08:00:00",
  };
}

describe("scoreBand：参考分档位（<60 低 / 60–79 中 / ≥80 高）", () => {
  it("三个阈值的边界各归各档", () => {
    expect(scoreBand(59)).toBe("low");
    expect(scoreBand(60)).toBe("mid");
    expect(scoreBand(79)).toBe("mid");
    expect(scoreBand(80)).toBe("high");
  });

  it("没有分数时是 none，不是 low——不能把「未分析」画成 0 分", () => {
    expect(scoreBand(null)).toBe("none");
    expect(scoreBand(undefined)).toBe("none");
    expect(scoreBand(Number.NaN)).toBe("none");
  });

  it("0 分是真实分数，落在 low 档（与「没有分数」区分开）", () => {
    expect(scoreBand(0)).toBe("low");
  });
});

describe("sortQueueItems：默认口径与稳定排序", () => {
  it("joined 口径原样返回（= 后端给的入队顺序）且不改入参", () => {
    const input = [item(1, 90), item(2, 30), item(3, 70)];
    const sorted = sortQueueItems(input, "joined");

    expect(sorted.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(sorted).not.toBe(input);
    // 浅拷贝：元素还是同一批对象（表格不应该被迫重新渲染整行）。
    expect(sorted[0]).toBe(input[0]);
  });

  it("score 口径按参考分从高到低", () => {
    const sorted = sortQueueItems([item(1, 30), item(2, 95), item(3, 70)], "score");
    expect(sorted.map((row) => row.id)).toEqual([2, 3, 1]);
  });

  it("同分之间保持原顺序（稳定排序，表格不会自己跳）", () => {
    const sorted = sortQueueItems([item(1, 70), item(2, 90), item(3, 70)], "score");
    expect(sorted.map((row) => row.id)).toEqual([2, 1, 3]);
  });

  it("未分析的条目垫底，且彼此之间仍保持原顺序", () => {
    const sorted = sortQueueItems(
      [item(1, null), item(2, 50), item(3, undefined), item(4, 80)],
      "score",
    );
    expect(sorted.map((row) => row.id)).toEqual([4, 2, 1, 3]);
  });
});

describe("nextSortKey：列头点击只在两个口径间切换", () => {
  it("joined → score → joined", () => {
    expect(nextSortKey("joined")).toBe("score");
    expect(nextSortKey("score")).toBe("joined");
  });
});

describe("firstLine：资产列只放首行", () => {
  it("多行文本取第一行", () => {
    expect(firstLine("您好\n第二行")).toBe("您好");
  });

  it("单行原样返回，空串不抛", () => {
    expect(firstLine("您好")).toBe("您好");
    expect(firstLine("")).toBe("");
  });
});
