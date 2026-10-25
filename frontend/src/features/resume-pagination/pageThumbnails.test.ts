// SPDX-License-Identifier: Apache-2.0
/** W08 页缩略图数据层：实际页数、末页占用、溢出/手动分页/问题聚合。 */
import { describe, expect, it } from "vitest";
import { parsePaginationReport } from "./paginationReport";
import { buildPageThumbnails, fillPercent, lastPageFillLabel } from "./pageThumbnails";

const BASE = {
  pages: 2,
  pages_needed: 2,
  overflow: false,
  page_limit: 3,
  truncated_at: null,
  manual_breaks: [],
  warnings: [],
  snapshot: { content_sha256: "a".repeat(64), render_config_sha256: "b".repeat(64) },
};

const OVERFLOW = {
  ...BASE,
  pages: 1,
  pages_needed: 2,
  overflow: true,
  page_limit: 1,
  truncated_at: {
    kind: "entry",
    section: "experience",
    object_id: "e2e_entry001",
    point_index: null,
    text_preview: "Core pipeline",
  },
  manual_breaks: [{ kind: "section", section: "projects", object_id: null, page: 1 }],
};

describe("buildPageThumbnails", () => {
  it("没有报告：measured=false、不编页数", () => {
    const model = buildPageThumbnails(null);
    expect(model.measured).toBe(false);
    expect(model.pages).toEqual([]);
    expect(model.totalPages).toBe(0);
  });

  it("多页无溢出：页数正确、只有末页有占用、无问题标记", () => {
    const report = parsePaginationReport({ ...BASE, last_page_fill: 0.62 });
    const model = buildPageThumbnails(report);
    expect(model.measured).toBe(true);
    expect(model.totalPages).toBe(2);
    expect(model.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(model.pages[0]).toMatchObject({ isLast: false, fill: null, issue: null });
    expect(model.pages[1]).toMatchObject({ isLast: true, fill: 0.62, issue: null });
    expect(lastPageFillLabel(model)).toEqual({ kind: "ratio", ratio: 0.62 });
  });

  it("溢出：截断页是 blocker、末页占用按确定事实显示「已截断」（不编百分比）", () => {
    const model = buildPageThumbnails(parsePaginationReport(OVERFLOW));
    expect(model.overflow).toBe(true);
    expect(model.pages[0].truncated).toBe(true);
    // 截断（blocker）与同一页的手动分页（suggestion）都落在第 1 页 → 聚合成 2 条。
    expect(model.pages[0].issue).toEqual({ severity: "blocker", count: 2 });
    expect(model.lastPageFill).toBeNull();
    expect(lastPageFillLabel(model)).toEqual({ kind: "truncated" });
  });

  it("手动分页落在第 N 页：该页 manualBreak=true（信息性质，不是 blocker）", () => {
    const model = buildPageThumbnails(parsePaginationReport(OVERFLOW));
    expect(model.pages[0].manualBreak).toBe(true);
    expect(model.pages[0].issue?.severity).toBe("blocker");
  });

  it("全局 warnings 原样带出（不属于某一页）", () => {
    const model = buildPageThumbnails(
      parsePaginationReport({
        ...BASE,
        warnings: [{ code: "repeat_name_no_room", detail: "上边距过小" }],
      }),
    );
    expect(model.warnings).toHaveLength(1);
    expect(model.warnings[0].code).toBe("repeat_name_no_room");
  });
});

describe("last_page_fill 解析（可选后端字段）", () => {
  it("0–1 比例被接受；越界/非数字为 null（不猜）", () => {
    expect(parsePaginationReport({ ...BASE, last_page_fill: 0.4 })?.lastPageFill).toBe(0.4);
    expect(parsePaginationReport(BASE)?.lastPageFill).toBeNull();
    expect(parsePaginationReport({ ...BASE, last_page_fill: 1.2 })?.lastPageFill).toBeNull();
    expect(parsePaginationReport({ ...BASE, last_page_fill: "half" })?.lastPageFill).toBeNull();
  });

  it("fillPercent 夹在 0–100", () => {
    expect(fillPercent(0.626)).toBe(63);
    expect(fillPercent(-0.2)).toBe(0);
    expect(fillPercent(1.5)).toBe(100);
  });
});
