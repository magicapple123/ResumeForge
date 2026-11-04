// SPDX-License-Identifier: Apache-2.0
/** W09 纯规则：约束过滤、取样、可读性、实测评估、不可行原因。 */
import { describe, expect, it } from "vitest";
import type { ResumeFitCandidate } from "../../types/resumeLayout";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import {
  changesBetween,
  defaultTargetPages,
  evaluateCandidate,
  filterCandidates,
  fitsAlready,
  fontDeltaPercent,
  keepImproved,
  noFeasibleReason,
  overflowForTarget,
  pickCandidateSamples,
  readabilityImpact,
  targetOptionsFor,
  toCandidateView,
} from "./constraints";
import type { OptimizerConstraints, OptimizerCurrentValues } from "./types";

const CURRENT: OptimizerCurrentValues = {
  page_padding: 14,
  section_gap: 1.3,
  line_height: 1.7,
  font_scale_adjust: 1,
};

const CONSTRAINTS: OptimizerConstraints = {
  lockFont: false,
  minMarginMm: null,
  keepEntriesWhole: true,
  targetPages: 1,
};

function candidate(key: string, config: ResumeFitCandidate["config"]): ResumeFitCandidate {
  return { key, label: key, config, css: "css-" + key };
}

const LADDER: ResumeFitCandidate[] = [
  candidate("padding", { page_padding: 12 }),
  candidate("gap", { page_padding: 12, section_gap: 1.1 }),
  candidate("line", { page_padding: 12, section_gap: 1.1, line_height: 1.6 }),
  candidate("font", {
    page_padding: 12,
    section_gap: 1.1,
    line_height: 1.6,
    font_scale_adjust: 0.96,
  }),
];

function measure(used: number, page = 1000, limit = 1): LayoutMeasure {
  return { usedHeight: used, pageContentHeight: page, pageLimit: limit };
}

describe("变化与可读性", () => {
  it("只列真正变了的参数，单位值原样保留", () => {
    expect(changesBetween(CURRENT, { page_padding: 12 })).toEqual([
      { key: "page_padding", from: 14, to: 12 },
    ]);
    expect(changesBetween(CURRENT, { page_padding: 14 })).toEqual([]);
  });

  it("可读性分级：只动页边距 < 动间距/行高 < 动字号", () => {
    expect(readabilityImpact([{ key: "page_padding", from: 14, to: 12 }])).toBe("none");
    expect(readabilityImpact([{ key: "section_gap", from: 1.3, to: 1.1 }])).toBe("mild");
    expect(readabilityImpact([{ key: "line_height", from: 1.7, to: 1.6 }])).toBe("mild");
    expect(readabilityImpact([{ key: "font_scale_adjust", from: 1, to: 0.96 }])).toBe("noticeable");
  });

  it("字号缩小百分比，仅改字号时才有值", () => {
    expect(fontDeltaPercent([{ key: "font_scale_adjust", from: 1, to: 0.96 }])).toBeCloseTo(4, 5);
    expect(fontDeltaPercent([{ key: "page_padding", from: 14, to: 12 }])).toBeNull();
  });
});

describe("约束过滤", () => {
  it("不动字号：排除所有改了字号系数的候选", () => {
    const result = filterCandidates(LADDER, CURRENT, { ...CONSTRAINTS, lockFont: true });
    expect(result.views.map((view) => view.key)).toEqual(["padding", "gap", "line"]);
    expect(result.rejectedByFontLock).toBe(1);
  });

  it("最小页边距：只排掉把页边距压到阈值以下的那一档，后续档不再连带", () => {
    // 阶梯是累积覆盖：第一档把 padding 从 14 压到 12（< 13）→ 只拒这一档；
    // 「区块间距 / 行高 / 字号」这三档本身没有再压页边距，不该被一起排掉。
    const result = filterCandidates(LADDER, CURRENT, { ...CONSTRAINTS, minMarginMm: 13 });
    expect(result.views.map((view) => view.key)).toEqual(["gap", "line", "font"]);
    expect(result.rejectedByMargin).toBe(1);
  });

  it("最小页边距 20mm：仍能拿到只改行高 / 字号的候选（问题 17）", () => {
    const result = filterCandidates(LADDER, CURRENT, { ...CONSTRAINTS, minMarginMm: 20 });
    const keys = result.views.map((view) => view.key);
    expect(keys).toContain("line");
    expect(keys).toContain("font");
    // 每档都**新**压一次页边距时才会逐个被拒（见下一个用例），这里只有第一档算"新压"。
    expect(result.rejectedByMargin).toBe(1);
  });

  it("保持条目完整对参数候选无差别（它约束的是内容候选）", () => {
    // 这一层阶梯只动 padding / 间距 / 行高 / 字号，本来就不动条目结构——两件事要分开断言：
    // 「参数候选无差别」在这里，「内容候选有差别」在 contentCandidates.test.ts。
    const on = filterCandidates(LADDER, CURRENT, { ...CONSTRAINTS, keepEntriesWhole: true });
    const off = filterCandidates(LADDER, CURRENT, { ...CONSTRAINTS, keepEntriesWhole: false });
    expect(on.views.map((view) => view.key)).toEqual(off.views.map((view) => view.key));
  });
});

describe("取样", () => {
  it("最多 3 个：温和（页边距）→ 中等（行高）→ 明显（字号）", () => {
    const { views } = filterCandidates(LADDER, CURRENT, CONSTRAINTS);
    expect(pickCandidateSamples(views).map((view) => view.key)).toEqual([
      "padding",
      "line",
      "font",
    ]);
  });

  it("去掉字号候选后只取样到有差异的两档，不去重失败", () => {
    const { views } = filterCandidates(LADDER, CURRENT, { ...CONSTRAINTS, lockFont: true });
    const picked = pickCandidateSamples(views);
    expect(picked.length).toBeLessThanOrEqual(3);
    expect(new Set(picked.map((view) => view.key)).size).toBe(picked.length);
    expect(picked.some((view) => view.key === "font")).toBe(false);
  });

  it("空列表返回空", () => {
    expect(pickCandidateSamples([])).toEqual([]);
  });
});

describe("收敛目标 = 用户选的篇幅", () => {
  it("默认目标取 page_limit，不再是写死的 1 页", () => {
    expect(defaultTargetPages(1)).toBe(1);
    expect(defaultTargetPages(2)).toBe(2);
    expect(defaultTargetPages(3)).toBe(3);
    // 0 = 不限篇幅：没有收敛目标，调用方据此跳过版式收敛。
    expect(defaultTargetPages(0)).toBe(1);
    expect(defaultTargetPages(undefined)).toBe(1);
  });

  it("选项包含用户真正选的那一档（3 页 / 长 CV）", () => {
    expect(targetOptionsFor(1)).toEqual([1, 2]);
    expect(targetOptionsFor(2)).toEqual([1, 2]);
    expect(targetOptionsFor(3)).toEqual([1, 2, 3]);
    expect(targetOptionsFor(10)).toEqual([1, 2, 10]);
  });
});

describe("实测评估", () => {
  const view = toCandidateView(LADDER[2], CURRENT);
  const before = measure(1200);

  it("溢出按目标页数算：放得下、减少量、是否真的有改善", () => {
    const after = measure(980);
    const result = evaluateCandidate(view, before, after, 1);
    expect(result.fits).toBe(true);
    expect(result.overflowAfter).toBe(0);
    expect(result.overflowReduced).toBe(200);
    expect(result.improved).toBe(true);
  });

  it("没变矮就不算改善（参数改了但实测没效果）", () => {
    const result = evaluateCandidate(view, before, measure(1200), 1);
    expect(result.improved).toBe(false);
    expect(result.overflowReduced).toBe(0);
  });

  it("目标两页时同一测量可能已放得下", () => {
    expect(overflowForTarget(measure(1900), 2)).toBe(0);
    expect(overflowForTarget(measure(2100), 2)).toBe(100);
    expect(fitsAlready(measure(1900), 2)).toBe(true);
    expect(fitsAlready(null, 1)).toBe(false);
  });

  it("按溢出减少量排序", () => {
    const input = [
      evaluateCandidate(view, before, measure(1100), 1),
      evaluateCandidate(view, before, measure(900), 1),
    ];
    expect(keepImproved(input).map((item) => item.after.usedHeight)).toEqual([900, 1100]);
  });
});

describe("不可行原因", () => {
  const filterOk = filterCandidates(LADDER, CURRENT, CONSTRAINTS);
  it("没量到 / 没有阶梯 / 被锁定排空", () => {
    expect(
      noFeasibleReason({ hasBefore: false, ladderLength: 0, filter: filterOk, measured: [] }),
    ).toBe("no_measure");
    expect(
      noFeasibleReason({ hasBefore: true, ladderLength: 0, filter: filterOk, measured: [] }),
    ).toBe("no_ladder");
    const locked = filterCandidates(
      // 每档都**新**压一次页边距（10 → 8），阈值 12 → 两档都被拒 → 真的排空了。
      [candidate("p10", { page_padding: 10 }), candidate("p8", { page_padding: 8 })],
      CURRENT,
      { ...CONSTRAINTS, minMarginMm: 12 },
    );
    expect(locked.views).toEqual([]);
    expect(
      noFeasibleReason({ hasBefore: true, ladderLength: 4, filter: locked, measured: [] }),
    ).toBe("locked_out");
  });

  it("试过但都没变得更矮 → no_room；有改善但仍放不下 → still_overflow", () => {
    const view = toCandidateView(LADDER[0], CURRENT);
    const before = measure(1200);
    const flat = [evaluateCandidate(view, before, before, 1)];
    expect(
      noFeasibleReason({ hasBefore: true, ladderLength: 4, filter: filterOk, measured: flat }),
    ).toBe("no_room");
    const improvedNotEnough = [evaluateCandidate(view, before, measure(1100), 1)];
    expect(
      noFeasibleReason({
        hasBefore: true,
        ladderLength: 4,
        filter: filterOk,
        measured: improvedNotEnough,
      }),
    ).toBe("still_overflow");
  });
});
