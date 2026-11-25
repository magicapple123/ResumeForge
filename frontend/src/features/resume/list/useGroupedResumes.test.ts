// SPDX-License-Identifier: Apache-2.0
/**
 * 折叠视图的补页上限（CR-33）：`total` 很大时只请求 20 页、停在 2000 条。
 *
 * 用一个假 fetcher 记录调用次数，不需要后端与组件。
 */
import { describe, expect, it, vi } from "vitest";
import type { Page, ResumeBrief } from "../../../types";
import {
  GROUP_FETCH_LIMIT,
  GROUP_FETCH_MAX_PAGES,
  GROUP_FETCH_PAGE_SIZE,
  loadResumesForGrouping,
} from "./useGroupedResumes";

function resume(id: number): ResumeBrief {
  return {
    id,
    title: `简历 ${id}`,
    job_id: null,
    job_title: "",
    company: "",
    source: "manual",
    favorite: false,
    note: "",
    model: "",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    template: "classic",
    format_name: "",
    format_config: {},
    page_limit: 1,
    font_scale: "standard",
    created_at: "2026-11-01T08:00:00",
    updated_at: "2026-11-01T08:00:00",
  };
}

function fakeFetcher(total: number, calls: { count: number }) {
  return vi.fn(async (page: number, pageSize: number): Promise<Page<ResumeBrief>> => {
    calls.count += 1;
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    const items: ResumeBrief[] = [];
    for (let id = start; id <= end; id += 1) items.push(resume(id));
    return { items, total };
  });
}

describe("loadResumesForGrouping 补页上限", () => {
  it("空列表只请求一次", async () => {
    const calls = { count: 0 };
    const result = await loadResumesForGrouping(fakeFetcher(0, calls));

    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(calls.count).toBe(1);
  });

  it("250 条按 100/页补 3 次，不截断", async () => {
    const calls = { count: 0 };
    const result = await loadResumesForGrouping(fakeFetcher(250, calls));

    expect(result.items).toHaveLength(250);
    expect(result.truncated).toBe(false);
    expect(calls.count).toBe(3);
  });

  it("总数正好 2000 时请求 20 次且不提示截断", async () => {
    const calls = { count: 0 };
    const result = await loadResumesForGrouping(fakeFetcher(2000, calls));

    expect(result.items).toHaveLength(GROUP_FETCH_LIMIT);
    expect(result.truncated).toBe(false);
    expect(calls.count).toBe(GROUP_FETCH_MAX_PAGES);
  });

  it("总数远大于上限时只请求 20 次，停在 2000 条并标记截断", async () => {
    const calls = { count: 0 };
    const result = await loadResumesForGrouping(fakeFetcher(5000, calls));

    expect(calls.count).toBe(GROUP_FETCH_MAX_PAGES);
    expect(calls.count).toBeLessThanOrEqual(20);
    expect(result.items).toHaveLength(GROUP_FETCH_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("每页请求的都必须是 100 条", async () => {
    const calls = { count: 0 };
    const fetcher = fakeFetcher(300, calls);
    await loadResumesForGrouping(fetcher);

    for (const args of fetcher.mock.calls) {
      expect(args[1]).toBe(GROUP_FETCH_PAGE_SIZE);
    }
  });
});
