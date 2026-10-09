/**
 * 投递队列准入徽标的回归测试。
 *
 * 覆盖修复 B：后端可能返回 `admission === null` 且 `requires_confirm === true`（例如匹配分析
 * 结论为空时，"需逐条确认"是后端准入判定的一部分）。此时徽标必须如实展示「需逐条确认」，
 * 不能因为 `admission` 为空就一律显示「未分析」而吞掉这个准入要求。
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

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listQueue.mockResolvedValue([]);
  apiMocks.listResumes.mockResolvedValue({ items: [], total: 0 });
  // 浏览器默认已启动：绝大多数用例不关心浏览器前置检查这一层。
  apiMocks.getBrowserStatus.mockResolvedValue({ state: "running" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ApplyQueuePanel 准入徽标", () => {
  it("admission 为空但 requires_confirm 为真时展示「需逐条确认」而非「未分析」", async () => {
    apiMocks.listQueue.mockResolvedValue([
      { ...BASE_ITEM, admission: null, requires_confirm: true },
    ]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("需逐条确认")).toBeInTheDocument();
    expect(screen.queryByText("未分析")).not.toBeInTheDocument();
  });

  it("admission 为空且无需确认时展示「未分析」", async () => {
    apiMocks.listQueue.mockResolvedValue([
      { ...BASE_ITEM, admission: null, requires_confirm: false },
    ]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("未分析")).toBeInTheDocument();
    expect(screen.queryByText("需逐条确认")).not.toBeInTheDocument();
  });

  it("有明确结论时保留原徽标，并叠加「需逐条确认」", async () => {
    apiMocks.listQueue.mockResolvedValue([
      { ...BASE_ITEM, admission: "needs_confirm", requires_confirm: true },
    ]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("需确认")).toBeInTheDocument();
    expect(screen.getByText("需逐条确认")).toBeInTheDocument();
  });

  it("队列里没有待投条目时禁用开始投递", async () => {
    apiMocks.listQueue.mockResolvedValue([
      { ...BASE_ITEM, status: "done" },
      { ...BASE_ITEM, id: 2, job_id: null, job_title: "已删除岗位" },
    ]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByRole("button", { name: /开始投递/ })).toBeDisabled();
  });

  it("浏览器未启动时点开始投递：给引导提示且不发创建任务请求", async () => {
    // 按钮保持可点（保留可发现性），但点击被引导——比 disable 或后端报错都好。
    apiMocks.listQueue.mockResolvedValue([{ ...BASE_ITEM }]);
    apiMocks.getBrowserStatus.mockResolvedValue({ state: "stopped" });

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    const start = await screen.findByRole("button", { name: /开始投递/ });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    expect(await screen.findByText("请先启动浏览器再开始投递")).toBeInTheDocument();
    expect(apiMocks.createApplyTask).not.toHaveBeenCalled();
  });
});

describe("ApplyQueuePanel 来源闸门", () => {
  const UNSUPPORTED: ApplyQueueItem = {
    ...BASE_ITEM,
    id: 9,
    job_id: 99,
    job_title: "朋友介绍的岗位",
    company: "无",
    apply_supported: false,
  };

  it("来源不支持的条目标出来、勾选框禁用，并在页面上说明怎么处理", async () => {
    apiMocks.listQueue.mockResolvedValue([{ ...BASE_ITEM }, { ...UNSUPPORTED }]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    // 等数据到位：告警出现即代表列表已渲染。
    expect(await screen.findByText(/队列里有 1 个岗位不能用投递台自动投递/)).toBeInTheDocument();
    expect(screen.getByText(/移出队列/)).toBeInTheDocument();

    // 「来源不支持」这个标签在行内，也在告警说明里；这里锁定行上的那一个。
    const row = screen.getByText("朋友介绍的岗位").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("来源不支持")).toBeInTheDocument();

    // 不可勾选：勾了也投不出去，不如一开始就不让选。
    const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.disabled).toBe(true);
  });

  it("全部来源受支持时不出现这条告警（不误报）", async () => {
    apiMocks.listQueue.mockResolvedValue([{ ...BASE_ITEM }]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText("后端开发");
    expect(screen.queryByText(/不能用投递台自动投递/)).not.toBeInTheDocument();
    expect(screen.queryByText("来源不支持")).not.toBeInTheDocument();
  });

  it("详情抽屉里说清「能不能自动投递」", async () => {
    apiMocks.listQueue.mockResolvedValue([{ ...UNSUPPORTED }]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /查看队列条目详情/ }));

    expect(await screen.findByText("自动投递")).toBeInTheDocument();
    expect(screen.getByText(/来源不支持：请到原网站自行投递/)).toBeInTheDocument();
  });
});

describe("ApplyQueuePanel 使用指引与详情", () => {
  it("顶部说清岗位从哪来、在队列里做什么、什么时候才真的投出去", async () => {
    apiMocks.listQueue.mockResolvedValue([{ ...BASE_ITEM }]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    const heading = await screen.findByText("队列里放的是「准备投、但还没投」的岗位");
    const flow = heading.closest(".ant-alert");
    expect(flow).not.toBeNull();
    // 入口、准入核对、编辑、以及"不勾选＝整队列投递"这四件事都要写清楚，
    // 用户反馈过"点进来不知道下一步干什么"。
    expect(flow).toHaveTextContent("加入投递台");
    expect(flow).toHaveTextContent("准入结论");
    expect(flow).toHaveTextContent("不勾选＝按顺序投整个队列");
    expect(flow).toHaveTextContent("开始投递");
  });

  it("队列为空时给出可照做的下一步", async () => {
    apiMocks.listQueue.mockResolvedValue([]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    expect(
      await screen.findByText("队列还是空的：先去「岗位广场」挑几个岗位。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/加完之后回到本页/)).toBeInTheDocument();
  });

  it("点岗位名打开详情抽屉（排队序号、使用简历、加入时间）", async () => {
    apiMocks.listQueue.mockResolvedValue([
      { ...BASE_ITEM, greeting: "您好，我想应聘这个岗位", resume_title: "通用版" },
    ]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /查看队列条目详情/ }));

    expect(await screen.findByText("排队序号")).toBeInTheDocument();
    expect(screen.getByText("第 1 位")).toBeInTheDocument();
    expect(screen.getByText("加入队列")).toBeInTheDocument();
    // 「通用版」表格里也显示一份（抽屉与表格各一份）。
    expect(screen.getAllByText("通用版").length).toBeGreaterThan(0);
  });
});

describe("ApplyQueuePanel 右键菜单与操作按钮位置", () => {
  it("右键点击行弹出与「···」一致的菜单（编辑 / 移出队列）", async () => {
    apiMocks.listQueue.mockResolvedValue([{ ...BASE_ITEM }]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    const titleCell = await screen.findByText("后端开发");
    const row = titleCell.closest("tr");
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row as HTMLElement);

    // 右键菜单出现编辑 / 移出队列。
    expect(await screen.findByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("移出队列")).toBeInTheDocument();
  });

  it("右键菜单按 Esc 关闭，焦点归还触发行内元素", async () => {
    apiMocks.listQueue.mockResolvedValue([{ ...BASE_ITEM }]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    const titleCell = await screen.findByText("后端开发");
    // 行内的岗位链接是可聚焦元素：先聚焦它，再右键唤出菜单。
    const link = titleCell.closest("button");
    expect(link).not.toBeNull();
    (link as HTMLElement).focus();

    fireEvent.contextMenu(titleCell.closest("tr") as HTMLElement);
    expect(await screen.findByText("编辑")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByText("编辑")).not.toBeInTheDocument();
    expect(link).toHaveFocus();
  });

  it("操作按钮容器位于最右（flex + justifyContent: flex-end）", async () => {
    apiMocks.listQueue.mockResolvedValue([{ ...BASE_ITEM }]);

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText("后端开发");
    const actions = document.querySelector(".apply-queue-actions");
    expect(actions).not.toBeNull();
    expect(actions).toHaveStyle({ display: "flex", justifyContent: "flex-end" });
  });
});

describe("ApplyQueuePanel 分页与刷新", () => {
  it("队列超过 10 条时出现分页器，一页只显示 10 条", async () => {
    // 此前 50 条一页且单页隐藏，队列长时整屏塞满、等于没有分页。
    apiMocks.listQueue.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => ({
        ...BASE_ITEM,
        id: index + 1,
        job_id: index + 1,
        job_title: `岗位 ${index + 1}`,
      })),
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
    let resolveQueue: (items: ApplyQueueItem[]) => void = () => {};
    apiMocks.listQueue.mockImplementation(
      () => new Promise<ApplyQueueItem[]>((resolve) => (resolveQueue = resolve)),
    );

    render(
      <AntdApp>
        <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
      </AntdApp>,
    );

    // 首次加载走骨架屏（data 为空），按钮随后才出现。
    resolveQueue([{ ...BASE_ITEM }]);
    const refresh = await screen.findByRole("button", { name: /刷新/ });
    await waitFor(() => expect(refresh).not.toHaveClass("ant-btn-loading"));

    // 再点刷新：请求挂起期间按钮保持转圈——此前点击毫无反馈，用户会以为没点上。
    apiMocks.listQueue.mockImplementation(
      () => new Promise<ApplyQueueItem[]>((resolve) => (resolveQueue = resolve)),
    );
    fireEvent.click(refresh);
    expect(refresh).toHaveClass("ant-btn-loading");

    resolveQueue([{ ...BASE_ITEM }]);
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
    apiMocks.listQueue.mockResolvedValue([
      withStatus(1, "待投岗位", "pending"),
      withStatus(2, "已投岗位", "done"),
    ]);

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
    apiMocks.listQueue.mockResolvedValue([
      { ...BASE_ITEM, id: 1, job_title: "可投岗位", admission: "allow" },
      { ...BASE_ITEM, id: 2, job_title: "未分析岗位", admission: null, requires_confirm: false },
    ]);

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
      Array.from({ length: 11 }, (_, index) =>
        withStatus(index + 1, `岗位 ${index + 1}`, "pending"),
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
    apiMocks.listQueue.mockResolvedValue([
      withStatus(1, "移出甲", "pending"),
      withStatus(2, "移出乙", "pending"),
    ]);
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
    const popoverTitle = await screen.findByText("确定把选中的 2 个岗位移出队列？");
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
