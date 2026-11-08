// SPDX-License-Identifier: Apache-2.0
/** ActionProposalCard（RF-01）：待确认写入提案的渲染、批准与拒绝路径。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantWriteProposal } from "../../../types";
import { t } from "../../../i18n";

const approveWriteProposal = vi.fn();
const rejectWriteProposal = vi.fn();
const getWriteProposal = vi.fn();
const preferenceMocks = vi.hoisted(() => ({ saveJobPreferenceForSession: vi.fn() }));

vi.mock("../../../api/assistant", () => ({
  approveWriteProposal: (...args: unknown[]) => approveWriteProposal(...args),
  rejectWriteProposal: (...args: unknown[]) => rejectWriteProposal(...args),
  getWriteProposal: (...args: unknown[]) => getWriteProposal(...args),
}));

// 只替换「只在这次对话」一个函数：isJobPreferenceProposalTool 等纯逻辑保持真实实现。
vi.mock("../../../api/jobPreferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/jobPreferences")>();
  return {
    ...actual,
    saveJobPreferenceForSession: preferenceMocks.saveJobPreferenceForSession,
  };
});

import ActionProposalCard from "./ActionProposalCard";

function proposal(overrides: Partial<AssistantWriteProposal> = {}): AssistantWriteProposal {
  return {
    proposal_id: "p1",
    tool_name: "create_reminder",
    dataset_id: "main",
    preview: {
      target: "日历提醒新提醒",
      scope: "新增 1 条（2 个字段）",
      changes: [{ field: "标题", before: null, after: "面试复盘" }],
    },
    created_at: "2026-10-10T10:00:00",
    expires_at: "2026-10-10T10:05:00",
    status: "pending",
    ...overrides,
  };
}

function renderCard(initial: AssistantWriteProposal) {
  return render(
    <AntdApp>
      <ActionProposalCard proposal={initial} />
    </AntdApp>,
  );
}

beforeEach(() => {
  approveWriteProposal.mockReset();
  rejectWriteProposal.mockReset();
  getWriteProposal.mockReset();
  preferenceMocks.saveJobPreferenceForSession.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ActionProposalCard", () => {
  it("渲染目标、范围与字段差异，并暴露确认/拒绝按钮", async () => {
    getWriteProposal.mockResolvedValue({ proposal: proposal() });
    renderCard(proposal());
    expect(screen.getByText("日历提醒新提醒")).toBeTruthy();
    expect(screen.getByText("新增 1 条（2 个字段）")).toBeTruthy();
    expect(screen.getByText(/面试复盘/)).toBeTruthy();
    await waitFor(() => {
      expect(getWriteProposal).toHaveBeenCalledWith("p1");
    });
    expect(screen.getByRole("button", { name: /确认执行/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /拒s*绝/ })).toBeTruthy();
  });

  it("批准后调用 API 并切换到已执行状态", async () => {
    getWriteProposal.mockResolvedValue({ proposal: proposal() });
    approveWriteProposal.mockResolvedValue({
      proposal: proposal({ status: "executed" }),
      summary: "新增了提醒",
      changed: true,
    });
    renderCard(proposal());
    const approveButton = await screen.findByRole("button", { name: /确认执行/ });
    fireEvent.click(approveButton);
    await waitFor(() => {
      expect(approveWriteProposal).toHaveBeenCalledWith("p1");
      expect(screen.getByText("已执行")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /确认执行/ })).toBeNull();
  });

  it("拒绝后调用 API 且不再提供确认入口", async () => {
    getWriteProposal.mockResolvedValue({ proposal: proposal() });
    rejectWriteProposal.mockResolvedValue({ proposal: proposal({ status: "rejected" }) });
    renderCard(proposal());
    const rejectButton = await screen.findByRole("button", { name: /拒s*绝/ });
    fireEvent.click(rejectButton);
    await waitFor(() => {
      expect(rejectWriteProposal).toHaveBeenCalledWith("p1");
      expect(screen.getByText("已拒绝")).toBeTruthy();
    });
  });

  it("提案已失效（后端 404）时不显示确认按钮", async () => {
    getWriteProposal.mockRejectedValue(new Error("提案不存在或已失效"));
    renderCard(proposal());
    await waitFor(() => {
      expect(screen.getByText("已失效")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /确认执行/ })).toBeNull();
  });

  it("非 pending 的历史提案直接按状态展示，不再拉取", () => {
    renderCard(proposal({ status: "executed" }));
    expect(screen.getByText("已执行")).toBeTruthy();
    expect(getWriteProposal).not.toHaveBeenCalled();
  });

  it("执行后显示服务端给的结果摘要（含自动留档的撤销点）", () => {
    renderCard(
      proposal({
        status: "executed",
        result_summary: "snapshot note: rollback version saved",
      }),
    );
    expect(screen.getByText(/rollback version saved/)).toBeTruthy();
  });
});

describe("写入提案的终态渲染（RR-05）", () => {
  it("后端返回 unknown（提交后失败）时不白屏，而是如实说结果未知", async () => {
    // 批准接口 409 + 随后的状态读取回来是 unknown：这是"数据可能已经落库"的终态，
    // 以前 STATUS_META 里没有这个键 → meta.color 抛错 → 整页被错误边界接管。
    approveWriteProposal.mockRejectedValue(new Error("写入结果未知（执行过程中数据已经提交）"));
    getWriteProposal.mockResolvedValue({ proposal: proposal({ status: "unknown" }) });
    renderCard(proposal());

    fireEvent.click(await screen.findByRole("button", { name: /确认执行/ }));

    expect(await screen.findByText("结果未知")).toBeInTheDocument();
    // 终态封死重放：不再给出执行入口。
    await waitFor(() => expect(screen.queryByRole("button", { name: /确认执行/ })).toBeNull());
  });

  it("未知状态值也能渲染（后端加终态时前端不该整页崩）", async () => {
    renderCard(proposal({ status: "brand_new_state" as AssistantWriteProposal["status"] }));
    expect(await screen.findByText("状态未知")).toBeInTheDocument();
  });
});

describe("求职偏好提案的两个按钮（T14）", () => {
  function preferenceProposal(
    overrides: Partial<AssistantWriteProposal> = {},
  ): AssistantWriteProposal {
    return proposal({
      tool_name: "create_job_preference",
      preview: {
        target: "Preference: target city",
        scope: "Long term",
        changes: [{ field: "target_city", before: null, after: "Hangzhou" }],
      },
      ...overrides,
    });
  }

  it("偏好提案只显示「以后都这样」与「只在这次对话」，不再有拒绝 / 确认执行", async () => {
    getWriteProposal.mockResolvedValue({ proposal: preferenceProposal() });
    renderCard(preferenceProposal());
    const longTerm = await screen.findByRole("button", {
      name: new RegExp(t("assistantUi.actionProposal.action.rememberLongTerm")),
    });
    expect(longTerm).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: new RegExp(t("assistantUi.actionProposal.action.sessionOnly")),
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /拒s*绝/ })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: new RegExp(t("assistantUi.actionProposal.action.approve")),
      }),
    ).toBeNull();
  });

  it("「以后都这样」走既有 approve 端点（长期生效）", async () => {
    getWriteProposal.mockResolvedValue({ proposal: preferenceProposal() });
    approveWriteProposal.mockResolvedValue({
      proposal: preferenceProposal({ status: "executed" }),
      summary: "",
      changed: true,
    });
    renderCard(preferenceProposal());
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(t("assistantUi.actionProposal.action.rememberLongTerm")),
      }),
    );
    await waitFor(() => expect(approveWriteProposal).toHaveBeenCalledWith("p1"));
  });

  it("「只在这次对话」调 session 端点，并把卡片刷新为已执行", async () => {
    getWriteProposal.mockResolvedValue({ proposal: preferenceProposal() });
    preferenceMocks.saveJobPreferenceForSession.mockResolvedValue({
      pref: {},
      proposal_id: "p1",
      proposal_status: "executed",
      summary: "session-only note",
    });
    renderCard(preferenceProposal());
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(t("assistantUi.actionProposal.action.sessionOnly")),
      }),
    );
    await waitFor(() =>
      expect(preferenceMocks.saveJobPreferenceForSession).toHaveBeenCalledWith("p1"),
    );
    expect(await screen.findByText("session-only note")).toBeInTheDocument();
    expect(screen.getByText(t("assistantUi.actionProposal.status.executed"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: new RegExp(t("assistantUi.actionProposal.action.sessionOnly")),
      }),
    ).toBeNull();
    expect(
      await screen.findByText(t("assistantUi.actionProposal.toast.sessionOnly")),
    ).toBeInTheDocument();
  });

  it("session 端点失败时报出可重试的提示，卡片仍可再次选择", async () => {
    getWriteProposal.mockResolvedValue({ proposal: preferenceProposal() });
    preferenceMocks.saveJobPreferenceForSession.mockRejectedValue(
      new Error("proposal_not_pending"),
    );
    renderCard(preferenceProposal());
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(t("assistantUi.actionProposal.action.sessionOnly")),
      }),
    );
    expect(await screen.findByText(/proposal_not_pending/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: new RegExp(t("assistantUi.actionProposal.action.sessionOnly")),
      }),
    ).toBeTruthy();
  });
});
