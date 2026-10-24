// SPDX-License-Identifier: Apache-2.0
/**
 * W08 报告 → 页标记：本模块只验证"委托 + 生命周期"；聚合口径的权威用例在
 * `features/resume-proview/pageMarkers.test.ts`（fe-delivery，唯一实现）。
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parsePaginationReport } from "./paginationReport";
import {
  createReportMarkersStore,
  pageMarkersForReport,
  syncPageMarkers,
  usePaginationReportMarkers,
} from "./paginationPageMarkers";

const RAW = {
  pages: 2,
  pages_needed: 3,
  page_limit: 2,
  overflow: true,
  truncated_at: {
    kind: "entry",
    section: "projects",
    object_id: "prj_12345678",
    text_preview: "x",
  },
  manual_breaks: [{ kind: "entry", object_id: "exp_12345678", section: "experience", page: 2 }],
  warnings: [{ code: "repeat_name_no_room", detail: "top margin" }],
  snapshot: { content_sha256: "c1", render_config_sha256: "r1" },
};

describe("paginationPageMarkers（委托画布侧唯一聚合）", () => {
  it("truncated_at 落上限页为 blocker；manual_breaks 同页合并计数；warnings 不进标记", () => {
    const markers = pageMarkersForReport(parsePaginationReport(RAW));
    expect(markers).toEqual([{ page: 2, severity: "blocker", count: 2 }]);
    expect(markers.some((marker) => marker.severity === "verify")).toBe(false);
  });

  it("没有报告 → 空数组（调用方据此清旧标记）", () => {
    expect(pageMarkersForReport(null)).toEqual([]);
    expect(pageMarkersForReport(parsePaginationReport({}))).toEqual([]);
  });

  it("syncPageMarkers 写 store；null 清空", () => {
    const store = createReportMarkersStore();
    syncPageMarkers(parsePaginationReport(RAW), store);
    expect(store.getSnapshot()).toHaveLength(1);
    syncPageMarkers(null, store);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("usePaginationReportMarkers：report 变化写入、卸载清空", () => {
    const store = createReportMarkersStore();
    const report = parsePaginationReport(RAW);
    const { unmount } = renderHook(() => usePaginationReportMarkers(report, store));
    expect(store.getSnapshot()).toEqual([{ page: 2, severity: "blocker", count: 2 }]);
    unmount();
    expect(store.getSnapshot()).toEqual([]);
  });
});
