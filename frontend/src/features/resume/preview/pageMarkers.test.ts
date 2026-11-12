// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  createPageMarkersStore,
  pageMarkersFromPaginationReport,
  pageMarkersStore,
  resetPageMarkers,
} from "./pageMarkers";

describe("W08 pagination/report → 页标记（W15 页导航消费）", () => {
  it("truncated_at → 页数上限的 blocker；manual_breaks 每处各计 1", () => {
    const markers = pageMarkersFromPaginationReport({
      page_limit: 2,
      truncated_at: { page: 2, object_id: "obj-1", section: "experience" },
      manual_breaks: [{ page: 1 }, { page: 2, section: "projects" }],
    });
    expect(markers).toEqual([
      { page: 1, severity: "suggestion", count: 1 },
      { page: 2, severity: "blocker", count: 2 },
    ]);
  });

  it("truncated_at 缺页码时落在 page_limit；越界页码忽略", () => {
    expect(
      pageMarkersFromPaginationReport({
        page_limit: 3,
        truncated_at: {},
        manual_breaks: [{ page: 9 }, 3],
      }),
    ).toEqual([{ page: 3, severity: "blocker", count: 2 }]);
  });

  it("同页多级严重度取最重；没有限页时只过滤非法页码", () => {
    const markers = pageMarkersFromPaginationReport({
      truncated_at: 5,
      manual_breaks: [5, 6],
    });
    expect(markers).toEqual([
      { page: 5, severity: "blocker", count: 2 },
      { page: 6, severity: "suggestion", count: 1 },
    ]);
  });

  it("空/畸形 report 返回空数组", () => {
    expect(pageMarkersFromPaginationReport(null)).toEqual([]);
    expect(pageMarkersFromPaginationReport({})).toEqual([]);
    expect(
      pageMarkersFromPaginationReport({ page_limit: 1, manual_breaks: [{ page: 0 }] }),
    ).toEqual([]);
  });

  it("store 写入/清空（W08-FE 接入用）", () => {
    const store = createPageMarkersStore();
    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().length));
    store.set([{ page: 2, severity: "blocker", count: 1 }]);
    store.set([]);
    unsubscribe();
    expect(seen).toEqual([1, 0]);
    resetPageMarkers();
    expect(pageMarkersStore.getSnapshot()).toEqual([]);
  });
});
