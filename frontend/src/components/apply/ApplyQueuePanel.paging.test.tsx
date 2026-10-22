// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列分页、筛选与跨页批量操作的回归测试。
 *
 * 从 ApplyQueuePanel.test.tsx 拆出（500 行预算守卫）：本文件聚焦列表行为——
 * 分页器、刷新反馈、状态/准入筛选、跨页全选与批量移出。徽标语义与右键菜单
 * 见 ApplyQueuePanel.test.tsx。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyQueueItem } from "../../types";
import ApplyQueuePanel from "./ApplyQueuePanel";

const apiMocks = vi.hoisted(() => ({
  listQueue: vi.fn(),
  createApplyTask: vi.fn(),
  getBrowserStatus: vi.fn(),
  reorderQueue: vi.fn(),
  removeQueueItem: vi.fn(),
  updateQueueItem: vi.fn(),
  previewGreeting: vi.fn(),
  listResumes: vi.fn(),
}));

vi.mock("../../api/apply", () => ({
  listQueue: apiMocks.listQueue,
  createApplyTask: apiMocks.createApplyTask,
  getBrowserStatus: apiMocks.getBrowserStatus,
  reorderQueue: apiMocks.reorderQueue,
  removeQueueItem: apiMocks.removeQueueItem,
  updateQueueItem: apiMocks.updateQueueItem,
  previewGreeting: apiMocks.previewGreeting,
  QueueConflictError: class QueueConflictError extends Error {},
}));

vi.mock("../../api/resumes", () => ({
  listResumes: apiMocks.listResumes,
}));

const BASE_ITEM: ApplyQueueItem = {
  id: 1,
  job_id: 11,
  job_title: "后端开发",
  company: "A公司",
  resume_id: null,
  resume_title: "",
  greeting: "",
  sort_order: 0,
  status: "pending",
  admission: null,
  hard_gate: null,
  requires_confirm: false,
  created_at: "2026-09-17T08:00:00",
  updated_at: "2026-09-17T08:00:00",
};

/** P2-2：GET /queue 响应改为 {items, total, truncated}，mock 统一从条目数组组装。 */
function queueList(items: ApplyQueueItem[]): {
  items: ApplyQueueItem[];
  total: number;
  truncated: boolean;
} {
  return { items, total: items.length, truncated: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listQueue.mockResolvedValue(queueList([]));
  apiMocks.listResumes.mockResolvedValue({ items: [], total: 0 });
  // 浏览器默认已启动：绝大多数用例不关心浏览器前置检查这一层。
  apiMocks.getBrowserStatus.mockResolvedValue({ state: "running" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ApplyQueuePanel 分页与刷新", () => {
  it("队列超过 10 条时出现分页器，一页只显示 10 条", async () => {
    // 此前 50 条一页且单页隐藏，队列长时整屏塞满、等于没有分页。
    apiMocks.listQueue.mockResolvedValue(
      queueList(
        Array.from({ length: 11 }, (_, index) => ({
          ...BASE_ITEM,
          id: index + 1,
          job_id: index + 1,
          job_title: `岗位 ${index + 1}`,
        })),
      ),
    );

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("岗位 1")).toBeInTheDocument();
    expect(document.querySelectorAll(".ant-table-tbody tr.ant-table-row")).toHaveLength(10);

    // 翻到第二页能看到第 11 条。
    fireEvent.click(screen.getByTitle("2"));
    expect(await screen.findByText("岗位 11")).toBeInTheDocument();
  });

  it("点刷新时按钮进入 loading 态（点击有可感知反馈）", async () => {
    let resolveQueue: (list: ReturnType<typeof queueList>) => void = () => {};
    apiMocks.listQueue.mockImplementation(
      () => new Promise<ReturnType<typeof queueList>>((resolve) => (resolveQueue = resolve)),
    );

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    // 首次加载走骨架屏（data 为空），按钮随后才出现。
    resolveQueue(queueList([{ ...BASE_ITEM }]));
    const refresh = await screen.findByRole("button", { name: /刷新/ });
    await waitFor(() => expect(refresh).not.toHaveClass("ant-btn-loading"));

    // 再点刷新：请求挂起期间按钮保持转圈——此前点击毫无反馈，用户会以为没点上。
    apiMocks.listQueue.mockImplementation(
      () => new Promise<ReturnType<typeof queueList>>((resolve) => (resolveQueue = resolve)),
    );
    fireEvent.click(refresh);
    expect(refresh).toHaveClass("ant-btn-loading");

    resolveQueue(queueList([{ ...BASE_ITEM }]));
    await waitFor(() => expect(refresh).not.toHaveClass("ant-btn-loading"));
  });
});

describe("ApplyQueuePanel 筛选、跨页全选与批量移出", () => {
  const withStatus = (id: number, title: string, status: ApplyQueueItem["status"]) => ({
    ...BASE_ITEM,
    id,
    job_id: id,
    job_title: title,
    status,
  });

  it("按状态筛选只显示对应条目，计数同时给出总数与筛选数", async () => {
    apiMocks.listQueue.mockResolvedValue(
      queueList([withStatus(1, "待投岗位", "pending"), withStatus(2, "已投岗位", "done")]),
    );

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("待投岗位")).toBeInTheDocument();
    expect(screen.getByText(/共 2 个岗位/)).toBeInTheDocument();

    // antd Select 交互按 CollectSiteFilters.test 的已验证模式：mouseDown(combobox, {button:0})
    // 打开下拉，option 用 .ant-select-item-option 作用域定位（不按 role 找，虚拟列表 name 不稳）。
    fireEvent.mouseDown(await screen.findByRole("combobox", { name: "按状态筛选" }), {
      button: 0,
    });
    const pendingOption = await screen.findByText(
      (content, element) => content === "待投递" && !!element?.closest(".ant-select-item-option"),
    );
    fireEvent.click(pendingOption);

    expect(screen.getByText("待投岗位")).toBeInTheDocument();
    expect(screen.queryByText("已投岗位")).not.toBeInTheDocument();
    expect(screen.getByText(/筛选出 1 个/)).toBeInTheDocument();
  });

  it("按准入筛选支持「未分析」（admission 为空的条目）", async () => {
    apiMocks.listQueue.mockResolvedValue(
      queueList([
        { ...BASE_ITEM, id: 1, job_title: "可投岗位", admission: "allow" },
        { ...BASE_ITEM, id: 2, job_title: "未分析岗位", admission: null, requires_confirm: false },
      ]),
    );

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText("未分析岗位");

    fireEvent.mouseDown(await screen.findByRole("combobox", { name: "按准入筛选" }), {
      button: 0,
    });
    const unanalyzedOption = await screen.findByText(
      (content, element) => content === "未分析" && !!element?.closest(".ant-select-item-option"),
    );
    fireEvent.click(unanalyzedOption);

    expect(screen.getByText("未分析岗位")).toBeInTheDocument();
    expect(screen.queryByText("可投岗位")).not.toBeInTheDocument();
  });

  it("「全选队列」跨页选中全部可投条目，计数显示已选数量", async () => {
    // 11 条：若只选当前页会是 10——这条断言守住跨页语义。
    apiMocks.listQueue.mockResolvedValue(
      queueList(
        Array.from({ length: 11 }, (_, index) =>
          withStatus(index + 1, `岗位 ${index + 1}`, "pending"),
        ),
      ),
    );

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "全选队列" }));
    expect(await screen.findByText(/已选 11 个/)).toBeInTheDocument();
  });

  it("批量移出逐条调用移出接口，完成后清空选择并给出账目", async () => {
    apiMocks.listQueue.mockResolvedValue(
      queueList([withStatus(1, "移出甲", "pending"), withStatus(2, "移出乙", "pending")]),
    );
    apiMocks.removeQueueItem.mockResolvedValue(undefined);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText("移出甲");
    fireEvent.click(screen.getByRole("button", { name: "全选队列" }));
    fireEvent.click(screen.getByRole("button", { name: "移出所选" }));

    // 确认按钮在 Popconfirm 浮层里（两字按钮名会被插空格，用正则匹配）。
    const popoverTitle = await screen.findByText("把选中的岗位移出队列？");
    fireEvent.click(
      within(popoverTitle.closest(".ant-popover") as HTMLElement).getByRole("button", {
        name: /移\s*出/,
      }),
    );

    await waitFor(() => expect(apiMocks.removeQueueItem).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("已把 2 个岗位移出队列")).toBeInTheDocument();
    expect(screen.getByText(/已选 0 个/)).toBeInTheDocument();
  });
});
