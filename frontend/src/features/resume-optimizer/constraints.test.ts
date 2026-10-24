// SPDX-License-Identifier: Apache-2.0
/** W09 纯规则：约束过滤、取样、可读性、实测评估、不可行原因。 */
import { describe, expect, it } from "vitest";
import type { ResumeFitCandidate } from "../../types/resumeLayout";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import {
  changesBetween,
  evaluateCandidate,
  filterCandidates,
  fitsAlready,
  fontDeltaPercent,
  keepImproved,
  noFeasibleReason,
  overflowForTarget,
  pickCandidateSamples,
  readabilityImpact,
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

  it("最小页边距：低于下限的候选被排除并计数", () => {
    const result = filterCandidates(LADDER, CURRENT, { ...CONSTRAINTS, minMarginMm: 13 });
    expect(result.views).toEqual([]);
    expect(result.rejectedByMargin).toBe(4);
  });

  it("保持条目完整不过滤候选（阶梯本来就不动结构）", () => {
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
    const locked = filterCandidates(LADDER, CURRENT, { ...CONSTRAINTS, minMarginMm: 20 });
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
