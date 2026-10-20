// SPDX-License-Identifier: Apache-2.0
/** useSelectAllJobs 的代次守卫（PR-14）：请求在途时切换筛选，旧筛选的 id 集合
 *  不得装进新视图；被作废的请求要释放 loading。 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DEFAULT_JOB_SORT_STATE, type JobSortState } from "../../utils/jobSort";
import { useSelectAllJobs } from "./useSelectAllJobs";

const apiMocks = vi.hoisted(() => ({ listJobIds: vi.fn() }));

vi.mock("../../api/jobs", () => apiMocks);

function Harness({
  keyword,
  sortState = DEFAULT_JOB_SORT_STATE,
}: {
  keyword: string;
  sortState?: JobSortState;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const { selectAllPages, selectAllPagesLoading } = useSelectAllJobs({
    keyword,
    jobType: "",
    status: "",
    sourceKind: "",
    sortState,
    setSelectedJobIds: (updater) => setSelected((prev) => updater(prev)),
  });
  return (
    <div>
      <button onClick={() => void selectAllPages()}>全选全部</button>
      <span data-testid="selected">{selected.join(",")}</span>
      <span data-testid="loading">{selectAllPagesLoading ? "loading" : "idle"}</span>
    </div>
  );
}

beforeEach(() => {
  apiMocks.listJobIds.mockReset();
});

afterEach(cleanup);

describe("useSelectAllJobs 代次守卫", () => {
  it("全选带上当前排序，保证 id 顺序与列表一致（R14）", async () => {
    apiMocks.listJobIds.mockResolvedValue([7]);
    render(
      <AntdApp>
        <Harness keyword="k" sortState={{ sort: "title_asc", order: "desc" }} />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "全选全部" }));

    await waitFor(() =>
      expect(apiMocks.listJobIds).toHaveBeenCalledWith({
        keyword: "k",
        job_type: "",
        status: "",
        source_kind: undefined,
        sort: "title_asc",
        order: "desc",
      }),
    );
  });

  it("筛选未变时正常全选：ids 整体写入选择", async () => {
    apiMocks.listJobIds.mockResolvedValue([4, 5]);
    render(
      <AntdApp>
        <Harness keyword="k" />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "全选全部" }));

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("4,5"));
  });

  it("请求在途时切换筛选：旧筛选的 ids 不会装进新视图，loading 立即归位", async () => {
    let resolveOld!: (ids: number[]) => void;
    apiMocks.listJobIds.mockImplementationOnce(
      () =>
        new Promise<number[]>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { rerender } = render(
      <AntdApp>
        <Harness keyword="旧筛选" />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: "全选全部" }));
    expect(screen.getByTestId("loading")).toHaveTextContent("loading");

    // 请求还在途就换筛选。
    rerender(
      <AntdApp>
        <Harness keyword="新筛选" />
      </AntdApp>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("idle"));

    await act(async () => {
      resolveOld([1, 2, 3]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 迟到的旧响应被代次守卫丢弃：选择不变、不弹成功提示。
    expect(screen.getByTestId("selected")).toHaveTextContent("");
    expect(screen.queryByText(/已选中当前筛选下的全部/)).not.toBeInTheDocument();
  });

  it("换筛选后重新发起全选：新筛选的响应正常落地", async () => {
    let resolveOld!: (ids: number[]) => void;
    apiMocks.listJobIds.mockImplementationOnce(
      () =>
        new Promise<number[]>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { rerender } = render(
      <AntdApp>
        <Harness keyword="旧筛选" />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: "全选全部" }));
    rerender(
      <AntdApp>
        <Harness keyword="新筛选" />
      </AntdApp>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("idle"));

    apiMocks.listJobIds.mockResolvedValue([9]);
    fireEvent.click(screen.getByRole("button", { name: "全选全部" }));
    await act(async () => {
      resolveOld([1, 2, 3]); // 旧响应比新响应晚到
    });
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("9"));
  });
});
