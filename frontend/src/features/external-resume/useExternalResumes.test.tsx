// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历列表的取数：关键词与岗位各自变化都要重新请求，且不能丢掉对方；同时暴露服务端
 * 返回的总数（不是当前页条数）。
 *
 * 守的是「筛选条件互相覆盖」：旧实现里改关键词会把岗位筛选清掉，用户以为自己在看某个岗位，
 * 实际看到的是全库。
 *
 * T09 起**排序与分页也在这条链路上**：`sort` / `order` / `page` 都进请求参数，改排序要
 * 回到第一页（否则"第 3 页按名字排"看起来像搜不到东西）。之前这里断言的是
 * `page_size: 100` + 不带 `page`——那是"一次取 100 条、不分页"的旧契约，行为变了就
 * 跟着改成 20 + 页码。
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DEFAULT_SORT_KEY,
  DEFAULT_SORT_ORDER,
  PAGE_SIZE,
  useExternalResumes,
} from "./useExternalResumes";

const api = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  uploadExternalResume: vi.fn(),
  deleteExternalResume: vi.fn(),
}));
vi.mock("../../api/externalResumes", () => api);
beforeEach(() => {
  api.listExternalResumes.mockReset().mockImplementation((params) =>
    Promise.resolve({
      items: [],
      total: params.keyword ? 1 : 101,
      page: params.page ?? 1,
      page_size: PAGE_SIZE,
    }),
  );
});
afterEach(cleanup);

/** 一次请求的四个必要参数：筛选两项 + 分页两项 + 排序两项。 */
function expected(overrides: Record<string, unknown> = {}) {
  return {
    keyword: undefined,
    job_id: undefined,
    page: 1,
    page_size: PAGE_SIZE,
    sort: DEFAULT_SORT_KEY,
    order: DEFAULT_SORT_ORDER,
    ...overrides,
  };
}

it("refetches when the keyword changes and exposes the server total", async () => {
  const { result, rerender } = renderHook(({ keyword }) => useExternalResumes({ keyword }), {
    initialProps: { keyword: "" },
  });
  await waitFor(() => expect(result.current.total).toBe(101));
  rerender({ keyword: "ByteDance" });
  await waitFor(() => expect(result.current.total).toBe(1));
  expect(api.listExternalResumes).toHaveBeenLastCalledWith(expected({ keyword: "ByteDance" }));
});

it("refetches when the job changes and preserves the keyword", async () => {
  const { rerender } = renderHook(({ jobId }) => useExternalResumes({ keyword: "Agent", jobId }), {
    initialProps: { jobId: 1 },
  });
  await waitFor(() =>
    expect(api.listExternalResumes).toHaveBeenCalledWith(expected({ keyword: "Agent", job_id: 1 })),
  );
  rerender({ jobId: 2 });
  await waitFor(() =>
    expect(api.listExternalResumes).toHaveBeenLastCalledWith(
      expected({ keyword: "Agent", job_id: 2 }),
    ),
  );
});

it("passes the sort down and goes back to page 1 when it changes", async () => {
  const { result, rerender } = renderHook(({ sort }) => useExternalResumes({ sort }), {
    initialProps: { sort: DEFAULT_SORT_KEY as "created_at" | "name" },
  });
  await waitFor(() => expect(api.listExternalResumes).toHaveBeenCalledWith(expected()));

  result.current.setPage(3);
  await waitFor(() =>
    expect(api.listExternalResumes).toHaveBeenLastCalledWith(expected({ page: 3 })),
  );

  rerender({ sort: "name" });
  // 排序一变就回第一页：停在"第 3 页 + 新排序"看起来像空列表。
  await waitFor(() =>
    expect(api.listExternalResumes).toHaveBeenLastCalledWith(expected({ sort: "name" })),
  );
});
