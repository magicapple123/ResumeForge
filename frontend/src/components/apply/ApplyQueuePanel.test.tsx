// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列准入徽标的回归测试。
 *
 * 覆盖修复 B：后端可能返回 `admission === null` 且 `requires_confirm === true`（例如匹配分析
 * 结论为空时，"需逐条确认"是后端准入判定的一部分）。此时徽标必须如实展示「需逐条确认」，
 * 不能因为 `admission` 为空就一律显示「未分析」而吞掉这个准入要求。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyQueueItem } from "../../types";
import { ContextMenuHost } from "../../features/context-menu/ContextMenuHost";
import { t } from "../../i18n";
import ApplyQueuePanel from "./ApplyQueuePanel";
import { APPLY_GUIDE_SEEN_KEY } from "./queue/ApplyQueueGuide";

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

/** #14 的补充接口：默认"体检没问题、没有话术模板"，个别用例再覆盖。 */
const extrasMocks = vi.hoisted(() => ({
  runQueuePreflight: vi.fn(),
  getGreetingTemplates: vi.fn(),
  getApplySummary: vi.fn(),
}));

vi.mock("../../api/applyExtras", () => ({
  runQueuePreflight: extrasMocks.runQueuePreflight,
  getGreetingTemplates: extrasMocks.getGreetingTemplates,
  getApplySummary: extrasMocks.getApplySummary,
}));

vi.mock("../../api/resumes", () => ({
  listResumes: apiMocks.listResumes,
}));

/** #15C/#15D 的新接口：默认"有体检结论、没有更好的简历"，个别用例再覆盖。 */
const insightsMocks = vi.hoisted(() => ({
  inspectQueueItem: vi.fn(),
  getResumeFit: vi.fn(),
}));

vi.mock("../../api/applyInsights", () => ({
  inspectQueueItem: insightsMocks.inspectQueueItem,
  getResumeFit: insightsMocks.getResumeFit,
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
  // 体检默认"干净"：只有专门测体检的用例才让它报 blocking。
  extrasMocks.runQueuePreflight.mockResolvedValue({
    items: [],
    summary: { blocking: 0, warnings: 0 },
  });
  extrasMocks.getGreetingTemplates.mockResolvedValue({ templates: [] });
  // #15C 体检默认返回一份"样本充足"的结论；#15D 默认没有更合适的简历。
  insightsMocks.inspectQueueItem.mockResolvedValue({
    queue_id: BASE_ITEM.id,
    salary: {
      status: "ok",
      sample: 12,
      median: 25,
      target: 30,
      delta_percent: 20,
      direction: "high",
    },
    same_company: { count: 0, in_queue: 0, applied: 0 },
    history: { applied: 0, succeeded: 0, failed: 0, no_reply: 0 },
  });
  insightsMocks.getResumeFit.mockResolvedValue({ items: [] });
  // 默认认为"说明已看过"（折叠）：绝大多数用例只关心队列本身，弹层不该出现在断言范围里。
  // 测 14G 的用例会显式清掉这个标记，验证"第一次进来会展开一次"。
  window.localStorage.setItem(APPLY_GUIDE_SEEN_KEY, "1");
});

/** 统一的挂载方式：面板里的空态与体检抽屉都含 `<Link>`，必须有 Router 上下文。 */
function renderPanel() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ContextMenuHost>
          <ApplyQueuePanel disabled={false} onStarted={vi.fn()} />
        </ContextMenuHost>
      </AntdApp>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ApplyQueuePanel 准入徽标", () => {
  it("admission 为空但 requires_confirm 为真时展示「需逐条确认」而非「未分析」", async () => {
    apiMocks.listQueue.mockResolvedValue(
      queueList([{ ...BASE_ITEM, admission: null, requires_confirm: true }]),
    );

    renderPanel();

    expect(await screen.findByText("需逐条确认")).toBeInTheDocument();
    expect(screen.queryByText("未分析")).not.toBeInTheDocument();
  });

  it("admission 为空且无需确认时展示「未分析」", async () => {
    apiMocks.listQueue.mockResolvedValue(
      queueList([{ ...BASE_ITEM, admission: null, requires_confirm: false }]),
    );

    renderPanel();

    expect(await screen.findByText("未分析")).toBeInTheDocument();
    expect(screen.queryByText("需逐条确认")).not.toBeInTheDocument();
  });

  it("有明确结论时保留原徽标，并叠加「需逐条确认」", async () => {
    apiMocks.listQueue.mockResolvedValue(
      queueList([{ ...BASE_ITEM, admission: "needs_confirm", requires_confirm: true }]),
    );

    renderPanel();

    expect(await screen.findByText("需确认")).toBeInTheDocument();
    expect(screen.getByText("需逐条确认")).toBeInTheDocument();
  });

  it("队列里没有待投条目时禁用开始投递", async () => {
    apiMocks.listQueue.mockResolvedValue(
      queueList([
        { ...BASE_ITEM, status: "done" },
        { ...BASE_ITEM, id: 2, job_id: null, job_title: "已删除岗位" },
      ]),
    );

    renderPanel();

    expect(await screen.findByRole("button", { name: /开始投递/ })).toBeDisabled();
  });

  it("浏览器未启动时点开始投递：给引导提示且不发创建任务请求", async () => {
    // 按钮保持可点（保留可发现性），但点击被引导——比 disable 或后端报错都好。
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...BASE_ITEM }]));
    apiMocks.getBrowserStatus.mockResolvedValue({ state: "stopped" });

    renderPanel();

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

  it("来源不支持的条目标出来、勾选框禁用，并在工具栏给出清理入口", async () => {
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...BASE_ITEM }, { ...UNSUPPORTED }]));

    renderPanel();

    // #14G：这条提示从 58px 的黄色横幅收成工具栏 chip——chip 出现即代表列表已渲染。
    const chip = await screen.findByRole("button", { name: "来源不支持 1" });
    // 点开就是就地确认：文案要说清后果（只是移出队列，岗位与投递记录都还在）。
    fireEvent.click(chip);
    expect(
      await screen.findByText(t("applyQueue.unsupported.chipTitle", { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("applyQueue.unsupported.chipBody"))).toBeInTheDocument();

    // 「来源不支持」这个标签在行内；这里锁定行上的那一个。
    const row = screen.getByText("朋友介绍的岗位").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("来源不支持")).toBeInTheDocument();

    // 不可勾选：勾了也投不出去，不如一开始就不让选。
    const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.disabled).toBe(true);
  });

  it("全部来源受支持时不出现这条告警（不误报）", async () => {
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...BASE_ITEM }]));

    renderPanel();

    await screen.findByText("后端开发");
    // #14G 之后判据是工具栏 chip：没有来源不支持的条目就整枚不出现。
    expect(screen.queryByRole("button", { name: /来源不支持/ })).not.toBeInTheDocument();
    expect(screen.queryByText("来源不支持")).not.toBeInTheDocument();
  });

  it("详情抽屉里说清「能不能自动投递」", async () => {
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...UNSUPPORTED }]));

    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /查看队列条目详情/ }));

    expect(await screen.findByText("自动投递")).toBeInTheDocument();
    expect(screen.getByText(/来源不支持：请到原网站自行投递/)).toBeInTheDocument();
  });
});

describe("ApplyQueuePanel 使用指引与详情", () => {
  it("四步说明收进标题旁的「?」，点开能读全（#14G）", async () => {
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...BASE_ITEM }]));

    renderPanel();

    // 默认收起：beforeEach 把 guide_seen 置为已看过，首屏那 96px 就是为了让表格多几行。
    await screen.findByText("后端开发");
    expect(screen.queryByText(t("applyQueue.guide.title"))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看队列使用说明" }));

    const heading = await screen.findByText(t("applyQueue.guide.title"));
    const flow = heading.closest(".ant-popover") as HTMLElement | null;
    expect(flow).not.toBeNull();
    // 入口、准入核对、编辑、以及"不勾选＝整队列投递"这四件事都要写清楚，
    // 用户反馈过"点进来不知道下一步干什么"——收起来不等于可以不写。
    expect(flow).toHaveTextContent("加入投递台");
    expect(flow).toHaveTextContent("准入结论");
    expect(flow).toHaveTextContent("不勾选＝按顺序投整个队列");
    expect(flow).toHaveTextContent("开始投递");
  });

  it("队列为空时给出可照做的下一步", async () => {
    apiMocks.listQueue.mockResolvedValue(queueList([]));

    renderPanel();

    expect(
      await screen.findByText("队列还是空的：先去「岗位广场」挑几个岗位。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/加完之后回到本页/)).toBeInTheDocument();
    // #14I：空态必须有一个**可点**的入口，不能只有一句"去岗位广场挑"的文字。
    expect(screen.getByRole("button", { name: t("applyQueue.empty.action") })).toBeInTheDocument();
  });

  it("点岗位名打开详情抽屉（排队序号、使用简历、加入时间）", async () => {
    apiMocks.listQueue.mockResolvedValue(
      queueList([{ ...BASE_ITEM, greeting: "您好，我想应聘这个岗位", resume_title: "通用版" }]),
    );

    renderPanel();

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
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...BASE_ITEM }]));

    renderPanel();

    const titleCell = await screen.findByText("后端开发");
    const row = titleCell.closest("tr");
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row as HTMLElement);

    // 右键菜单出现编辑 / 移出队列。
    expect(await screen.findByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("移出队列")).toBeInTheDocument();
  });

  it("右键菜单按 Esc 关闭，焦点归还触发行内元素", async () => {
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...BASE_ITEM }]));

    renderPanel();

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
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...BASE_ITEM }]));

    renderPanel();

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
      queueList(
        Array.from({ length: 11 }, (_, index) => ({
          ...BASE_ITEM,
          id: index + 1,
          job_id: index + 1,
          job_title: `岗位 ${index + 1}`,
        })),
      ),
    );

    renderPanel();

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

    renderPanel();

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

describe("ApplyQueuePanel 岗位体检与优化指派（#15C / #15D）", () => {
  it("「优化指派」只在勾选之后出现在工具栏", async () => {
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...BASE_ITEM }]));

    renderPanel();

    // 没勾选时没有对象可优化，入口不该占工具栏宽度。
    await screen.findByText(BASE_ITEM.job_title);
    expect(
      screen.queryByRole("button", { name: t("applyQueue.insights.fit.action") }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.filter.selectAll") }));

    expect(
      await screen.findByRole("button", { name: t("applyQueue.insights.fit.action") }),
    ).toBeInTheDocument();
  });

  it("点行内「体检」只为这一条取数，并把结论显示在卡片里", async () => {
    apiMocks.listQueue.mockResolvedValue(queueList([{ ...BASE_ITEM }]));

    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: t("applyQueue.insights.inspect.action") }),
    );

    // 传的是队列条目 id（不是岗位 id）——两者通常不同，传错会体检到别的岗位。
    expect(insightsMocks.inspectQueueItem).toHaveBeenCalledWith(BASE_ITEM.id);
    expect(
      await screen.findByText(t("applyQueue.insights.inspect.salary.label")),
    ).toBeInTheDocument();
  });
});
