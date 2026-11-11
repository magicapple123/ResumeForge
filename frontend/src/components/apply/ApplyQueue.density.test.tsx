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
import { ContextMenuHost } from "../../features/context-menu/ContextMenuHost";
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

  it("「清空选择」收进「⋯」：未展开时不在页面上，展开后是可点的菜单项", async () => {
    renderPanel();

    await screen.findByText(ITEM.job_title);
    expect(
      screen.queryByRole("button", { name: t("applyQueue.filter.clearSelection") }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.more.aria") }));
    expect(
      await screen.findByRole("menuitem", {
        name: new RegExp(t("applyQueue.filter.clearSelection")),
      }),
    ).toBeInTheDocument();
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
