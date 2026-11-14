// SPDX-License-Identifier: Apache-2.0
/** 投递记录（按批次分组）：组头统计、展开看明细、详情 Drawer 完整失败信息（含 URL）。 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyRecord, Page } from "../../types";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import ApplyRecordsPanel from "./ApplyRecordsPanel";
import {
  BATCHES,
  BATCH_ITEMS,
  RECORD,
  RECORD_SUCCESS,
  batchHead,
  renderPanel,
  resetApplyRecordsPanelApiMocks,
} from "../../test/applyRecordsPanelHarness";

const apiMocks = vi.hoisted(() => ({
  listRecordBatches: vi.fn(),
  listRecordBatchItems: vi.fn(),
  retryRecord: vi.fn(),
  deleteRecord: vi.fn(),
  deleteRecordBatch: vi.fn(),
  batchDeleteRecords: vi.fn(),
}));

vi.mock("../../api/apply", () => ({
  listRecordBatches: apiMocks.listRecordBatches,
  listRecordBatchItems: apiMocks.listRecordBatchItems,
  retryRecord: apiMocks.retryRecord,
  deleteRecord: apiMocks.deleteRecord,
  deleteRecordBatch: apiMocks.deleteRecordBatch,
  batchDeleteRecords: apiMocks.batchDeleteRecords,
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetApplyRecordsPanelApiMocks(apiMocks);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ApplyRecordsPanel (grouped by batch)", () => {
  it("loads concurrently expanded batches without invalidating another batch", async () => {
    let resolveFirst!: (value: Page<ApplyRecord>) => void;
    const firstResponse = new Promise<Page<ApplyRecord>>((resolve) => {
      resolveFirst = resolve;
    });
    apiMocks.listRecordBatchItems.mockImplementation((id: number) =>
      id === 7
        ? firstResponse
        : Promise.resolve({
            items: [{ ...RECORD_SUCCESS, id: 3, task_id: 6, job_title: "并行批次的岗位" }],
            total: 1,
          }),
    );
    await renderPanel();
    fireEvent.click(batchHead(7));
    fireEvent.click(batchHead(6));
    expect(await screen.findByText("并行批次的岗位")).toBeInTheDocument();
    await act(async () => resolveFirst(BATCH_ITEMS));
    expect(await screen.findByText(RECORD.job_title)).toBeInTheDocument();
    expect(apiMocks.listRecordBatchItems).toHaveBeenCalledTimes(2);
  });

  it("初次分组请求走轻量分页（include_items=false），组头展示命中数", async () => {
    await renderPanel();

    expect(screen.getByTestId("record-batch-7")).toBeInTheDocument();
    expect(screen.getByTestId("record-batch-6")).toBeInTheDocument();
    // 轻量分页：批次不带明细，只带 matched_count。
    await waitFor(() => {
      const calls = apiMocks.listRecordBatches.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ include_items: false });
    });
    // 组头展示「N 条记录」（来自 matched_count，而不是本地数 items）。
    const head7 = batchHead(7);
    expect(within(head7).getByText("批次 #7")).toBeInTheDocument();
    expect(within(head7).getByText(/^2 条记录/)).toBeInTheDocument();
    expect(within(head7).getByText(/成功 1/)).toBeInTheDocument();
    expect(within(head7).getByText(/失败 1/)).toBeInTheDocument();
    // 未展开时不该调明细端点。
    expect(apiMocks.listRecordBatchItems).not.toHaveBeenCalled();
    // 未展开时看不到岗位明细。
    expect(screen.queryByText("高级后端工程师（高并发方向）")).not.toBeInTheDocument();
  });

  it("展开批次时才调明细端点（带与列表一致的筛选参数），折叠再展开用缓存", async () => {
    await renderPanel();

    // 展开批次 7：调明细端点，参数与列表一致。
    fireEvent.click(batchHead(7));
    expect(await screen.findByText("高级后端工程师（高并发方向）")).toBeInTheDocument();
    expect(apiMocks.listRecordBatchItems).toHaveBeenCalledTimes(1);
    expect(apiMocks.listRecordBatchItems).toHaveBeenCalledWith(7, {
      keyword: "",
      result: "",
      // #39：明细必须与组头吃同一套筛选（漏传 failure_category 就是「组头 1 条、明细 6 条」）。
      failure_category: "",
      page: 1,
      page_size: 20,
    });
    expect(screen.getByText("全栈工程师")).toBeInTheDocument();
    // 「详 情」独立按钮已并入「···」菜单（重投仍是行内按钮）。
    expect(screen.queryByRole("button", { name: /详\s*情/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /重投/ }).length).toBeGreaterThanOrEqual(2);

    // 折叠不丢：收起再展开不再重复调明细端点。
    fireEvent.click(batchHead(7));
    fireEvent.click(batchHead(7));
    expect(await screen.findByText("高级后端工程师（高并发方向）")).toBeInTheDocument();
    expect(apiMocks.listRecordBatchItems).toHaveBeenCalledTimes(1);
  });

  it("明细支持批内服务端翻页", async () => {
    apiMocks.listRecordBatchItems.mockResolvedValue({
      items: [RECORD_SUCCESS],
      total: 22,
    });
    await renderPanel();

    fireEvent.click(batchHead(7));
    expect((await screen.findAllByText("全栈工程师")).length).toBeGreaterThan(0);
    // total=22 > 20：批内分页器出现，翻到第 2 页携带 page=2。
    fireEvent.click(await screen.findByTitle("2"));
    await waitFor(() => {
      const calls = apiMocks.listRecordBatchItems.mock.calls;
      expect(calls[calls.length - 1]).toEqual([7, expect.objectContaining({ page: 2 })]);
    });
  });

  it("opens the detail Drawer from the row's ··· menu with full failure info including the URL", async () => {
    await renderPanel();
    fireEvent.click(batchHead(7));
    await screen.findByText("高级后端工程师（高并发方向）");
    // 「查看详情」收在行内「···」菜单里（独立「详 情」按钮已合并）。
    const row = screen.getByText("高级后端工程师（高并发方向）").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("查看详情"));

    const drawer = await screen.findByRole("dialog");
    expect(
      within(drawer).getByText(/失败页面 URL：https:\/\/example\.com\/job\/12345/),
    ).toBeInTheDocument();
    expect(within(drawer).getByText(/批次 #7 · 第 2 次尝试/)).toBeInTheDocument();
  });

  it("does not enable a horizontal scroll bar (no scroll.x on the table)", async () => {
    const { container } = render(
      <AntdApp>
        <MemoryRouter>
          <ApplyRecordsPanel disabled={false} onRetried={vi.fn()} />
        </MemoryRouter>
      </AntdApp>,
    );
    await screen.findByTestId("record-batch-7");
    fireEvent.click(batchHead(7));
    await screen.findByText("高级后端工程师（高并发方向）");

    // scroll.x 未设置：AntD 不会渲染横向滚动容器 .ant-table-content（它是 scroll.x 专属）。
    expect(container.querySelector(".ant-table-content")).toBeNull();
    // 纵向滚动容器仍在（scroll.y），列表高度受限、可纵向滚动。
    expect(container.querySelector(".ant-table-body")).not.toBeNull();
  });

  it("shows an empty state when there are no batches", async () => {
    apiMocks.listRecordBatches.mockResolvedValue({ items: [], total: 0 });
    render(
      <AntdApp>
        <MemoryRouter>
          <ApplyRecordsPanel disabled={false} onRetried={vi.fn()} />
        </MemoryRouter>
      </AntdApp>,
    );
    expect(await screen.findByText("还没有投递记录")).toBeInTheDocument();
  });
});

describe("明细请求竞态守卫（PR-14）", () => {
  /** Input.Search 里的文本输入框（本 describe 自用，避免跨 describe 复用内部函数）。 */
  function searchInput(): HTMLInputElement {
    return screen.getByPlaceholderText("搜索岗位 / 公司").closest("input") as HTMLInputElement;
  }

  it("慢的旧明细响应晚返回，不把旧筛选的数据写回新视图", async () => {
    let resolveOld: (value: Page<ApplyRecord>) => void = () => {};
    const oldResponse = new Promise<Page<ApplyRecord>>((resolve) => {
      resolveOld = resolve;
    });
    // 第一次明细请求（旧筛选）挂起不返回；新筛选的补拉请求立即返回新数据。
    apiMocks.listRecordBatchItems
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValue({ items: [RECORD_SUCCESS], total: 1 });
    // 每次返回新对象引用（与真实响应一致）：组件按 data 引用变化清明细缓存。
    apiMocks.listRecordBatches.mockImplementation(async () => ({ ...BATCHES }));

    await renderPanel();
    fireEvent.click(batchHead(7)); // 发起旧筛选下的明细请求（一直挂起）

    // 换筛选：列表重拉 → 缓存清空 → 展开中的批次按新筛选补拉（立即返回）。
    const input = searchInput();
    fireEvent.change(input, { target: { value: "全栈" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findAllByText("全栈工程师")).length).toBeGreaterThan(0);

    // 旧响应此刻才姗姗来迟，带着旧筛选（无关键词）的数据。
    await act(async () => {
      resolveOld({ items: [RECORD], total: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 若没有代次守卫，旧数据会在此刻覆盖新视图：旧岗位必须不出现。
    expect(screen.queryByText("高级后端工程师（高并发方向）")).not.toBeInTheDocument();
    expect(screen.getAllByText("全栈工程师").length).toBeGreaterThan(0);
  });
});

describe("F11：批次卡折叠后不留 padding", () => {
  it("padding 只挂在展开时才存在的内层，折叠态 body 没有 padding", () => {
    // 行为断言看不出"少了 20px"，所以直接读样式表：body 只负责压高度，padding 归内层。
    const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();
    const css = readFileSync([cwd, "src", "styles", "apply.css"].join("/"), "utf8");
    const body = css.match(/\.apply-records-batch-body \{([^}]*)\}/)?.[1] ?? "";
    const inner = css.match(/\.apply-records-batch-body-inner \{([^}]*)\}/)?.[1] ?? "";

    expect(body).toContain("min-height: 0");
    expect(body).toContain("overflow: hidden");
    expect(body).not.toContain("padding:");
    expect(inner).toContain("padding: 8px 12px 12px");
  });
});
