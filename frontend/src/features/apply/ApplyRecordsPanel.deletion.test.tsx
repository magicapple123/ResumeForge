// SPDX-License-Identifier: Apache-2.0
/** 投递记录：分页器、整批/单条删除、批内多选删除与搜索框受控化（从 ApplyRecordsPanel.test.tsx 拆出）。 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BATCHES,
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

describe("投递记录分页器", () => {
  it("多页时渲染分页器，翻页携带 page 重新加载；单页时不出现", async () => {
    // 12 个批次、每页 10 个 → 两页，分页器应出现。
    apiMocks.listRecordBatches.mockResolvedValue({ items: BATCHES.items, total: 12 });
    await renderPanel();
    expect(await screen.findByTitle("2")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("2"));
    await waitFor(() => {
      const calls = apiMocks.listRecordBatches.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ page: 2 });
    });

    // 只有一页时分页器隐藏（hideOnSinglePage，与旧文字链行为对齐）。
    cleanup();
    document.body.innerHTML = "";
    apiMocks.listRecordBatches.mockResolvedValue(BATCHES);
    await renderPanel();
    expect(screen.queryByTitle("2")).not.toBeInTheDocument();
  });
});

describe("删除投递记录", () => {
  it("整批删：组头的「删除本批」带二次确认，确认后调接口并刷新", async () => {
    apiMocks.deleteRecordBatch.mockResolvedValue(undefined);
    await renderPanel();

    fireEvent.click(batchHead(7));
    await screen.findByText("高级后端工程师（高并发方向）");

    // 组头的删除收进了「···」菜单：打开菜单 → 点「删除本批」→ 确认。
    fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[0]);
    fireEvent.click(await screen.findByText(/删除本批（2 条）/));
    // 必须二次确认——删除是用户可见的破坏性动作。
    expect((await screen.findAllByText("删除这一批的记录？")).length).toBeGreaterThan(0);
    // 条数按 §4.4 的例外移到正文（标题只写动作 + 对象）。用 textContent 而不是 ByText：
    // 断言的是"正文里有没有条数"，不是新增一处文案查询。
    await waitFor(() => {
      expect(document.querySelector(".ant-modal-confirm")?.textContent).toContain(
        "这 2 条投递记录会移入回收站",
      );
    });
    expect(apiMocks.deleteRecordBatch).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(apiMocks.deleteRecordBatch).toHaveBeenCalledWith(7));
  });

  it("单条删：行内的删除按钮带二次确认，确认后按记录 id 调接口", async () => {
    apiMocks.deleteRecord.mockResolvedValue(undefined);
    await renderPanel();

    fireEvent.click(batchHead(7));
    await screen.findByText("高级后端工程师（高并发方向）");

    // 单条删除同样收进行内「···」菜单。
    const row = screen.getByText("高级后端工程师（高并发方向）").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("删除"));
    expect((await screen.findAllByText(/删除这条投递记录/)).length).toBeGreaterThan(0);
    expect(apiMocks.deleteRecord).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(apiMocks.deleteRecord).toHaveBeenCalledWith(1));
  });

  it("取消时什么都不做——二次确认必须真的拦得住", async () => {
    await renderPanel();

    fireEvent.click(batchHead(7));
    await screen.findByText("高级后端工程师（高并发方向）");
    fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[0]);
    fireEvent.click(await screen.findByText(/删除本批/));
    await screen.findAllByText(/删除这一批/);

    // 无 locale 时取消键是 "Cancel"。
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(apiMocks.deleteRecordBatch).not.toHaveBeenCalled();
  });

  it("批内多选：组头菜单进选择模式 → 勾 2 条 → 删除所选（直接删，撤销在 Toast）→ 一次批量删除并重拉", async () => {
    apiMocks.batchDeleteRecords.mockResolvedValue({ deleted: 2 });
    // reload 后 data 必须是**新对象**（真实后端每次返回新响应），明细缓存才会作废重取；
    // mockResolvedValue 会复用同一引用，绕开 prevData 守卫让重取断言失真。
    apiMocks.listRecordBatches.mockImplementation(async () => ({
      items: BATCHES.items,
      total: BATCHES.total,
    }));
    await renderPanel();

    fireEvent.click(batchHead(7));
    await screen.findByText("高级后端工程师（高并发方向）");

    // 入口在组头「···」菜单：多选范围＝批内明细表。
    fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[0]);
    fireEvent.click(await screen.findByText("批量选择"));

    // 明细表出现 rowSelection：第 0 个是工具条「全选本页」，第 1 个是表头全选，之后是数据行。
    const pageSelectAll = screen
      .getAllByRole("checkbox")
      .find((box) => (box.closest("label")?.textContent ?? "").includes("全选本页"));
    const rowBoxes = () => screen.getAllByRole("checkbox").filter((box) => box !== pageSelectAll);
    fireEvent.click(rowBoxes()[1]!);
    fireEvent.click(rowBoxes()[2]!);
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    // 软删可撤销：不再前置确认，点一下就直接发请求（撤销在 Toast 上）。

    await waitFor(() => {
      expect(apiMocks.batchDeleteRecords).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.batchDeleteRecords).toHaveBeenCalledWith([1, 2]);
    // 成功后清空选择并 reload：分组列表重拉、展开中的批次明细缓存作废后重取。
    expect(await screen.findByText(/已删除 2 条投递记录/)).toBeInTheDocument();
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
    await waitFor(
      () => {
        expect(apiMocks.listRecordBatches.mock.calls.length).toBeGreaterThan(1);
        expect(apiMocks.listRecordBatchItems.mock.calls.length).toBeGreaterThan(1);
      },
      { timeout: 5000 },
    );
  });
});

describe("投递记录搜索框（受控化）", () => {
  /** Input.Search 里的文本输入框。 */
  function searchInput(): HTMLInputElement {
    return screen.getByPlaceholderText("搜索岗位 / 公司").closest("input") as HTMLInputElement;
  }

  it("点 × 清空后立即按空关键词重新加载（不再沿用旧关键词筛选）", async () => {
    await renderPanel();
    const input = searchInput();

    // 输入关键词并回车搜索。
    fireEvent.change(input, { target: { value: "后端" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const calls = apiMocks.listRecordBatches.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ keyword: "后端" });
    });

    // 点 × 清空：输入框变空的同时，筛选也要跟着变空。
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => {
      const calls = apiMocks.listRecordBatches.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ keyword: "" });
    });
    expect(input.value).toBe("");
  });

  it("回车搜索后输入框与筛选保持一致（受控镜像回填）", async () => {
    await renderPanel();
    const input = searchInput();

    fireEvent.change(input, { target: { value: "前端" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const calls = apiMocks.listRecordBatches.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ keyword: "前端" });
    });
    // 受控镜像从 keyword 同步回来，输入框不会被antd内部状态带跑。
    expect(input.value).toBe("前端");
  });
});
