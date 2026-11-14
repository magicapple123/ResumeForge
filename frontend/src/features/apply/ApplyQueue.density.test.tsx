// SPDX-License-Identifier: Apache-2.0
/**
 * 队列首屏密度的**结构断言**（#14H 第二版）。jsdom 不排版，所以这里只钉"折叠关系"：
 * 哪个块被删了、哪个动作被收进了「⋯」、哪个按钮只在勾选后出现。
 * 真正的几何（首行 Y ≤ 300、可见 ≥7 行）由 `tests/smoke/apply-first-screen.spec.ts`
 * 在真实 Chromium 里量——两条合起来才算"首屏够高"的证据，光靠元素存在不算。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyQueueItem } from "../../types";
import { ContextMenuHost } from "../context-menu/ContextMenuHost";
import { t } from "../../i18n";
import ApplyQueuePanel from "./ApplyQueuePanel";
import { APPLY_GUIDE_SEEN_KEY } from "./queue/ApplyQueueGuide";

// `@types/node` 没装（与 ApplySettingsModal.actions.test 同款）：只声明本文件用到的那一小块。
declare const process: { cwd(): string };

const apiMocks = vi.hoisted(() => ({
  listQueue: vi.fn(),
  createApplyTask: vi.fn(),
  getBrowserStatus: vi.fn(),
  removeQueueItem: vi.fn(),
  listResumes: vi.fn(),
}));

vi.mock("../../api/apply", () => ({
  listQueue: apiMocks.listQueue,
  createApplyTask: apiMocks.createApplyTask,
  getBrowserStatus: apiMocks.getBrowserStatus,
  reorderQueue: vi.fn(),
  removeQueueItem: apiMocks.removeQueueItem,
  updateQueueItem: vi.fn(),
  previewGreeting: vi.fn(),
  QueueConflictError: class QueueConflictError extends Error {},
}));

vi.mock("../../api/resumes", () => ({
  listResumes: apiMocks.listResumes,
}));

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

const ITEM: ApplyQueueItem = {
  id: 1,
  job_id: 11,
  job_title: "后端开发",
  company: "A公司",
  resume_id: null,
  resume_title: "",
  greeting: "您好",
  sort_order: 0,
  status: "pending",
  admission: null,
  hard_gate: null,
  requires_confirm: false,
  match_score: 70,
  favorite: false,
  created_at: "2026-09-17T08:00:00",
  updated_at: "2026-09-17T08:00:00",
};

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

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listQueue.mockResolvedValue({ items: [ITEM], total: 1, truncated: false });
  apiMocks.listResumes.mockResolvedValue({ items: [], total: 0 });
  apiMocks.getBrowserStatus.mockResolvedValue({ state: "running" });
  extrasMocks.runQueuePreflight.mockResolvedValue({
    items: [],
    summary: { blocking: 0, warnings: 0 },
  });
  extrasMocks.getGreetingTemplates.mockResolvedValue({ templates: [] });
  window.localStorage.setItem(APPLY_GUIDE_SEEN_KEY, "1");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("队列首屏密度（14H 第二版）", () => {
  it("独立的「投递队列 ?」标题行已删除（页签已经写着队列名，那 40px 是重复）", async () => {
    const { container } = renderPanel();

    await screen.findByText(ITEM.job_title);
    expect(container.querySelector(".apply-queue-titlebar")).toBeNull();
    // 但说明入口不能被一起删掉：它在工具栏右侧的 `?`。
    expect(
      screen.getByRole("button", { name: t("applyQueue.guide.triggerAria") }),
    ).toBeInTheDocument();
  });

  it("「清空选择」只在勾选后出现，点一下把已选清回 0（F06：不再藏在「⋯」里）", async () => {
    renderPanel();

    await screen.findByText(ITEM.job_title);
    // 0 选中：既没有「清空选择」，也没有那颗点开只有一条禁用项的「⋯」。
    expect(
      screen.queryByRole("button", { name: t("applyQueue.filter.clearSelection") }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^更多操作$/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.filter.selectAll") }));
    const clear = await screen.findByRole("button", {
      name: t("applyQueue.filter.clearSelection"),
    });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: t("applyQueue.filter.clearSelection") }),
      ).not.toBeInTheDocument(),
    );
  });

  it("吸底条右侧给全局助手球留了避让（读样式表，不是只加类名）", () => {
    // 几何关系（按钮右缘 ≤ 球左缘−4）由 tests/smoke/apply-first-screen.spec.ts 在真实浏览器里量；
    // jsdom 不排版，这里只钉"避让确实写进了样式表"，防止有人把这条规则删掉而没人发现。
    const css = readFileSync(
      [process.cwd(), "src", "styles", "apply-density.css"].join("/"),
      "utf8",
    );
    const block = /\.apply-queue-startbar\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const padding = /padding-right:\s*(\d+)px/.exec(block);
    expect(padding, "吸底条必须声明 padding-right 避让助手球").not.toBeNull();
    // 助手球直径约 48–56px：留得比它小仍然会被压住，所以按 56 兜底。
    expect(Number(padding![1])).toBeGreaterThanOrEqual(56);
  });

  it("「批量套用模板」只在勾选后出现（没勾选时不该占工具栏宽度）", async () => {
    renderPanel();

    await screen.findByText(ITEM.job_title);
    expect(
      screen.queryByRole("button", { name: t("applyQueue.template.batch") }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.filter.selectAll") }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: t("applyQueue.template.batch") }),
      ).toBeInTheDocument(),
    );
  });
});

/**
 * F09：队列头部三组（筛选 / 计数与批量动作 / 工具），宽屏并成一行。
 *
 * jsdom 不排版，量不了"到底是不是一行"，所以这里钉两件**能钉住回归**的事：
 * 1. DOM 确实是三组，且每组装的东西没串位（分组是并排的前提）；
 * 2. 样式表里那条容器查询与默认两行的网格区域还在——有人删掉阈值或改回 flex，
 *    用例立刻红，而不是等 1440 截图才发现。
 * 真正的几何（1440 一行 / 1080 两行 / 1120 与 1099 的临界）由
 * `deliverables/run/shot-f04-10.mjs` 在真实 Chromium 里量。
 */
describe("队列头部三组（F09）", () => {
  it("筛选 / 批量 / 工具各成一组，且工具组在最右", async () => {
    const { container } = renderPanel();

    await screen.findByText(ITEM.job_title);
    const groups = [...container.querySelectorAll(".apply-queue-head > div")].map(
      (el) => el.className,
    );
    expect(groups).toEqual(["apply-queue-filters", "apply-queue-batch", "apply-queue-tools"]);

    const filters = container.querySelector(".apply-queue-filters");
    const batch = container.querySelector(".apply-queue-batch");
    const tools = container.querySelector(".apply-queue-tools");
    // 两个筛选下拉在筛选组；计数与「全选队列」在批量组；说明入口在工具组。
    expect(filters?.querySelectorAll(".ant-select")).toHaveLength(2);
    expect(batch?.textContent).toContain(t("applyQueue.filter.count", { total: 1, selected: 0 }));
    expect(
      tools?.querySelector(`[aria-label="${t("applyQueue.guide.triggerAria")}"]`),
    ).not.toBeNull();
  });

  it("样式表：容器查询挂在队列面板上，默认两行、≥1166 一行三组", () => {
    const css = readFileSync(
      [process.cwd(), "src", "features", "apply", "applyInformationHierarchy.css"].join("/"),
      "utf8",
    );

    const panel = /\.apply-page \.apply-queue-panel\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(panel, "队列面板必须声明容器查询的尺寸依据").toMatch(/container-type:\s*inline-size/);
    expect(panel).toMatch(/container-name:\s*rf-queue/);

    const head = /\.apply-page \.apply-queue-head\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    // 默认（窄容器）两行：筛选与工具同排，批量动作独占下一行。
    expect(head.replace(/\s+/g, " ")).toContain('"filters tools" "batch batch"');

    // 阈值 1166 是实测的一行最小内容宽：1120 正侧在选中态会挤成两行（78px），故取 1166；1440 面板恰好 1166，1080 为 974。
    // 用 lastIndexOf：文件顶部的 F09 注释里也写着这行字，取最后一条才是真正的 at-rule。
    const at = css.lastIndexOf("@container rf-queue (min-width: 1166px)");
    expect(at, "缺少 ≥1166 的容器查询").toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}", at));
    expect(block).toContain('"filters batch tools"');
    // 一行模式下组间靠左竖线断句，不再有 batch 的上边线。
    expect(block).toMatch(/border-inline-start:\s*1px solid/);
  });
});
