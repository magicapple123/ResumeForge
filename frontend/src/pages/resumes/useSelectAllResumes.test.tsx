// SPDX-License-Identifier: Apache-2.0
/** useSelectAllResumes 的代次守卫（PR-14）：对齐 useSelectAllJobs 的行为——
 *  请求在途时切换筛选，旧筛选的 id 集合不得装进新视图。 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useSelectAllResumes } from "./useSelectAllResumes";

const apiMocks = vi.hoisted(() => ({ listResumeIds: vi.fn() }));

vi.mock("../../api/resumes", () => apiMocks);

function Harness({ keyword, jobId }: { keyword: string; jobId?: number }) {
  const [selected, setSelected] = useState<number[]>([]);
  const { selectAllPages, selectAllPagesLoading } = useSelectAllResumes({
    keyword,
    jobId,
    hasJobFilter: undefined,
    setSelectedIds: setSelected,
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
  apiMocks.listResumeIds.mockReset();
});

afterEach(cleanup);

describe("useSelectAllResumes 代次守卫", () => {
  it("筛选未变时正常全选：ids 整体写入选择", async () => {
    apiMocks.listResumeIds.mockResolvedValue([4, 5]);
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
    apiMocks.listResumeIds.mockImplementationOnce(
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
});
