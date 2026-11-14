// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历列表的取数：关键词与岗位各自变化都要重新请求，且不能丢掉对方；同时暴露服务端
 * 返回的总数（不是当前页条数）。
 *
 * 守的是「筛选条件互相覆盖」：旧实现里改关键词会把岗位筛选清掉，用户以为自己在看某个岗位，
 * 实际看到的是全库。
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useExternalResumes } from "./useExternalResumes";

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
      page: 1,
      page_size: 100,
    }),
  );
});
afterEach(cleanup);

it("refetches when the keyword changes and exposes the server total", async () => {
  const { result, rerender } = renderHook(({ keyword }) => useExternalResumes({ keyword }), {
    initialProps: { keyword: "" },
  });
  await waitFor(() => expect(result.current.total).toBe(101));
  rerender({ keyword: "ByteDance" });
  await waitFor(() => expect(result.current.total).toBe(1));
  expect(api.listExternalResumes).toHaveBeenLastCalledWith({
    keyword: "ByteDance",
    job_id: undefined,
    page_size: 100,
  });
});

it("refetches when the job changes and preserves the keyword", async () => {
  const { rerender } = renderHook(({ jobId }) => useExternalResumes({ keyword: "Agent", jobId }), {
    initialProps: { jobId: 1 },
  });
  await waitFor(() =>
    expect(api.listExternalResumes).toHaveBeenCalledWith({
      keyword: "Agent",
      job_id: 1,
      page_size: 100,
    }),
  );
  rerender({ jobId: 2 });
  await waitFor(() =>
    expect(api.listExternalResumes).toHaveBeenLastCalledWith({
      keyword: "Agent",
      job_id: 2,
      page_size: 100,
    }),
  );
});
