// SPDX-License-Identifier: Apache-2.0
/**
 * #14A 投递前体检的接线测试：按钮 → 抽屉、开始投递 → 自动跑一次 → blocking 弹确认。
 *
 * 三条判据分别钉一个"断线就会静默失效"的点：
 * 1. 「投递前检查」按钮真的调了 `POST /queue/preflight`（不是只打开一个空抽屉）；
 * 2. 点「开始投递」时会**自动再跑一次**（用户可能刚改过招呼语）；
 * 3. 有 blocking 时弹确认但**不禁用**——与后端 409 语义一致，是提醒不是新准入门；
 *    体检接口本身挂了则**不拦**（体检是保险，不该成为新的单点故障）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyQueueItem } from "../../types";
import { ContextMenuHost } from "../context-menu/ContextMenuHost";
import { t } from "../../i18n";
import ApplyQueuePanel from "./ApplyQueuePanel";
import { APPLY_GUIDE_SEEN_KEY } from "./queue/ApplyQueueGuide";

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
  greeting: "您好，我想应聘这个岗位，有三年后端经验。",
  sort_order: 0,
  status: "pending",
  admission: null,
  hard_gate: null,
  requires_confirm: false,
  match_score: 72,
  favorite: false,
  created_at: "2026-09-17T08:00:00",
  updated_at: "2026-09-17T08:00:00",
};

/** 后端返回的结论文案：断言时当数据引用，避免把后端措辞写进测试的界面文案口径。 */
const BLOCKING_ISSUE = {
  message: "这一条没有可用简历，投递会在填写阶段被跳过。",
  fix: "换成可用简历",
};

const DIRTY = {
  items: [
    {
      queue_id: 1,
      issues: [
        {
          code: "resume_missing" as const,
          severity: "blocking" as const,
          message: BLOCKING_ISSUE.message,
          fix: BLOCKING_ISSUE.fix,
        },
        {
          code: "match_missing" as const,
          severity: "warning" as const,
          message: "「后端开发」还没做过匹配分析。",
          fix: "去岗位广场做匹配分析",
        },
      ],
    },
  ],
  summary: { blocking: 1, warnings: 1 },
};

const CLEAN = { items: [], summary: { blocking: 0, warnings: 0 } };

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
  apiMocks.createApplyTask.mockResolvedValue({ id: 5, kind: "apply", status: "running" });
  apiMocks.removeQueueItem.mockResolvedValue(undefined);
  extrasMocks.runQueuePreflight.mockResolvedValue(CLEAN);
  extrasMocks.getGreetingTemplates.mockResolvedValue({ templates: [] });
  window.localStorage.setItem(APPLY_GUIDE_SEEN_KEY, "1");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ApplyQueuePanel 投递前体检（14A）", () => {
  it("「投递前检查」按钮会真的跑一次体检，并按严重度分组展示", async () => {
    extrasMocks.runQueuePreflight.mockResolvedValue(DIRTY);

    renderPanel();

    await screen.findByText(ITEM.job_title);
    fireEvent.click(screen.getByRole("button", { name: /投递前检查/ }));

    expect(
      await screen.findByText(t("applyQueue.preflight.blocking", { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("applyQueue.preflight.warning", { count: 1 }))).toBeInTheDocument();
    // 后端文案原样展示，前端不重写一遍。
    expect(screen.getByText(BLOCKING_ISSUE.message)).toBeInTheDocument();
    expect(
      screen.getByText(t("applyQueue.preflight.fixLabel", { fix: BLOCKING_ISSUE.fix })),
    ).toBeInTheDocument();
    // 没勾选任何条目时体检范围是整队列 → 不传 queue_ids。
    expect(extrasMocks.runQueuePreflight).toHaveBeenCalledWith(undefined);
  });

  it("点「开始投递」时自动再跑一次体检，有 blocking 弹确认但不禁用", async () => {
    extrasMocks.runQueuePreflight.mockResolvedValue(DIRTY);

    renderPanel();

    const start = await screen.findByRole("button", { name: /开始投递/ });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    // 确认弹层出现：这是提醒，不是硬拦（按钮从没被禁用过）。
    expect(await screen.findByText(t("applyQueue.preflight.confirmTitle"))).toBeInTheDocument();
    expect(
      screen.getByText(t("applyQueue.preflight.confirmBody", { count: 1 })),
    ).toBeInTheDocument();
    expect(apiMocks.createApplyTask).not.toHaveBeenCalled();

    // 「仍要投递」按用户意志继续投。
    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.preflight.confirmGo") }));
    await waitFor(() => expect(apiMocks.createApplyTask).toHaveBeenCalledTimes(1));
  });

  it("「先不投」不投；用户改完再点开始投递，仍会先体检、仍不绕过提醒", async () => {
    extrasMocks.runQueuePreflight.mockResolvedValue(DIRTY);

    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /开始投递/ }));
    await screen.findByText(t("applyQueue.preflight.confirmTitle"));
    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.preflight.confirmCancel") }));

    // 取消＝这次不投（一行不发），但"仍要投递"的权利留在原处，不需要重新勾选。
    await waitFor(() => expect(apiMocks.createApplyTask).not.toHaveBeenCalled());

    extrasMocks.runQueuePreflight.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /开始投递/ }));

    // 再次点开始投递会**再跑一次**体检（用户可能刚改过招呼语/换了简历），而不是复用上次结论。
    await waitFor(() => expect(extrasMocks.runQueuePreflight).toHaveBeenCalledTimes(1));
    expect(apiMocks.createApplyTask).not.toHaveBeenCalled();
  });

  it("体检没问题时直接投递，不多一次确认", async () => {
    extrasMocks.runQueuePreflight.mockResolvedValue(CLEAN);

    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /开始投递/ }));

    await waitFor(() => expect(apiMocks.createApplyTask).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(t("applyQueue.preflight.confirmTitle"))).not.toBeInTheDocument();
  });

  it("体检接口挂了不拦投递（体检是保险，不是新的单点故障）", async () => {
    extrasMocks.runQueuePreflight.mockRejectedValue(new Error("preflight 挂了"));

    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /开始投递/ }));

    await waitFor(() => expect(apiMocks.createApplyTask).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(t("applyQueue.preflight.confirmTitle"))).not.toBeInTheDocument();
  });
});
