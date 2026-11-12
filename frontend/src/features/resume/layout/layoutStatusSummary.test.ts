// SPDX-License-Identifier: Apache-2.0
/**
 * 版面状态判据与文案（#24 24C）的纯函数单测。
 *
 * 钉的是四条最容易漂的边界：
 * 1. 占用率的分母是 `一页正文高 × 页数上限`（不是"总高 ÷ 页数"，也不是 `usedHeight` 自身）；
 * 2. `pageLimit = 0`（不限篇幅）时**没有结论**而不是 0 / Infinity；
 * 3. 需要几页是**向上取整**，且服务端分页报告优先；
 * 4. 琥珀阈值是**严格大于 100**，且"健康 / 未知"的后端状态不留颜色信号。
 *
 * 本文件不含 CJK 字面量（棘轮对新增中文断言会红）：期望文案一律由同一个 `t()` 解析。
 */
import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import type { LayoutMeasure } from "../../../utils/resumeLayoutMeasure";
import {
  FILL_ATTENTION_PERCENT,
  layoutFillLabel,
  layoutFillPercent,
  layoutNeedsAttention,
  layoutOverflowPages,
  layoutPagesNeeded,
  summarizeLayoutStatus,
} from "./layoutStatusSummary";

function measure(overrides: Partial<LayoutMeasure> = {}): LayoutMeasure {
  return { usedHeight: 1000, pageContentHeight: 1000, pageLimit: 1, ...overrides };
}

describe("layoutFillPercent", () => {
  it("divides by one page of body height times the page limit", () => {
    // 4260 / (1000 x 1) = 4.26 -> 426%
    expect(layoutFillPercent(measure({ usedHeight: 4260 }))).toBe(426);
    // 同一份内容，上限放到 5 页：4260 / (1000 x 5) = 85.2% -> 85%
    expect(layoutFillPercent(measure({ usedHeight: 4260, pageLimit: 5 }))).toBe(85);
    // 刚好排满 = 100%（这条与"是否需要琥珀"配合：100 不算溢出）
    expect(layoutFillPercent(measure({ usedHeight: 1000 }))).toBe(100);
  });

  it("returns null when there is no usable denominator", () => {
    expect(layoutFillPercent(null)).toBeNull();
    // 不限篇幅：没有"上限"可比，不许折算成 0 或 Infinity
    expect(layoutFillPercent(measure({ pageLimit: 0 }))).toBeNull();
    expect(layoutFillPercent(measure({ pageContentHeight: 0 }))).toBeNull();
  });

  it("formats through the same message key the preview card uses", () => {
    expect(layoutFillLabel(measure({ usedHeight: 4260 }))).toBe(
      t("resume.diagnosis.fill", { percent: 426 }),
    );
    expect(layoutFillLabel(null)).toBeNull();
  });
});

describe("layoutPagesNeeded", () => {
  it("rounds up and never reports zero pages", () => {
    expect(layoutPagesNeeded(measure({ usedHeight: 1000 }))).toBe(1);
    expect(layoutPagesNeeded(measure({ usedHeight: 1001 }))).toBe(2);
    expect(layoutPagesNeeded(measure({ usedHeight: 2500 }))).toBe(3);
    expect(layoutPagesNeeded(measure({ usedHeight: 0 }))).toBe(1);
  });

  it("prefers the server page report when it is available", () => {
    expect(layoutPagesNeeded(measure({ usedHeight: 1001 }), 7)).toBe(7);
    // 0 / 负数都不是有效报告，退回本地推算
    expect(layoutPagesNeeded(measure({ usedHeight: 1001 }), 0)).toBe(2);
    expect(layoutPagesNeeded(measure({ usedHeight: 1001 }), -3)).toBe(2);
  });

  it("returns null without a measurable page body", () => {
    expect(layoutPagesNeeded(null)).toBeNull();
    expect(layoutPagesNeeded(measure({ pageContentHeight: 0 }))).toBeNull();
  });
});

describe("layoutOverflowPages", () => {
  it("counts the pages beyond the limit", () => {
    expect(layoutOverflowPages(measure({ usedHeight: 5000 }))).toBe(4);
    expect(layoutOverflowPages(measure({ usedHeight: 1000 }))).toBe(0);
    // 放得下时不会是负数
    expect(layoutOverflowPages(measure({ usedHeight: 10 }))).toBe(0);
  });

  it("is always zero when the page count is unlimited", () => {
    expect(layoutOverflowPages(measure({ usedHeight: 5000, pageLimit: 0 }))).toBe(0);
  });
});

describe("layoutNeedsAttention", () => {
  it("keeps the strict greater-than threshold", () => {
    expect(FILL_ATTENTION_PERCENT).toBe(100);
    expect(layoutNeedsAttention({ fillPercent: 101 })).toBe(true);
    expect(layoutNeedsAttention({ fillPercent: 100 })).toBe(false);
    expect(layoutNeedsAttention({ fillPercent: null })).toBe(false);
  });

  it("lets the backend status win, and treats healthy/unknown as neutral", () => {
    expect(layoutNeedsAttention({ status: "dense", fillPercent: 40 })).toBe(true);
    expect(layoutNeedsAttention({ status: "overflow" })).toBe(true);
    expect(layoutNeedsAttention({ status: "healthy", fillPercent: 400 })).toBe(false);
    expect(layoutNeedsAttention({ status: "unknown", overflow: true })).toBe(false);
  });

  it("falls back to the canvas overflow flag before the local fill", () => {
    expect(layoutNeedsAttention({ overflow: true, fillPercent: 12 })).toBe(true);
  });
});

describe("summarizeLayoutStatus", () => {
  it("builds the overflow sentence from the shared keys", () => {
    const summary = summarizeLayoutStatus({
      measure: measure({ usedHeight: 5000 }),
      layoutStatus: null,
    });
    expect(summary.fillPercent).toBe(500);
    expect(summary.pagesNeeded).toBe(5);
    expect(summary.pageLimit).toBe(1);
    expect(summary.overflowPages).toBe(4);
    expect(summary.attention).toBe(true);
    expect(summary.badge).toBe(t("resume.diagnosis.fill", { percent: 500 }));
    expect(summary.summary).toBe(
      t("workbench.layoutStatus.summaryOverflow", {
        percent: 500,
        pages: 5,
        limit: 1,
        over: 4,
      }),
    );
  });

  it("drops the overflow clause when everything fits", () => {
    const summary = summarizeLayoutStatus({
      measure: measure({ usedHeight: 900, pageLimit: 1 }),
    });
    expect(summary.overflowPages).toBe(0);
    expect(summary.attention).toBe(false);
    expect(summary.summary).toBe(
      t("workbench.layoutStatus.summary", { percent: 90, pages: 1, limit: 1 }),
    );
  });

  it("says 'no limit' instead of inventing one", () => {
    const summary = summarizeLayoutStatus({
      measure: measure({ usedHeight: 2500, pageLimit: 0 }),
    });
    expect(summary.fillPercent).toBeNull();
    expect(summary.badge).toBeNull();
    expect(summary.pageLimit).toBe(0);
    expect(summary.summary).toBe(t("workbench.layoutStatus.summaryUnlimited", { pages: 3 }));
  });

  it("reports 'measuring' until a measure arrives", () => {
    expect(summarizeLayoutStatus({ measure: null }).summary).toBe(
      t("workbench.layoutStatus.measuring"),
    );
  });

  it("takes the overflow flag from the canvas report even when the fill rounds to 100", () => {
    const summary = summarizeLayoutStatus({
      measure: measure({ usedHeight: 999 }),
      layoutStatus: { pages: 1, overflow: true, pagesNeeded: 2 },
    });
    // 页数用服务端报告（2 页），超出 1 页
    expect(summary.pagesNeeded).toBe(2);
    expect(summary.overflowPages).toBe(1);
    expect(summary.attention).toBe(true);
  });
});
