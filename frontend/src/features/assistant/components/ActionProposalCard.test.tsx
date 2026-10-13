/** ActionProposalCard（RF-01）：待确认写入提案的渲染、批准与拒绝路径。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantWriteProposal } from "../../../types";

const approveWriteProposal = vi.fn();
const rejectWriteProposal = vi.fn();
const getWriteProposal = vi.fn();

vi.mock("../../../api/assistant", () => ({
  approveWriteProposal: (...args: unknown[]) => approveWriteProposal(...args),
  rejectWriteProposal: (...args: unknown[]) => rejectWriteProposal(...args),
  getWriteProposal: (...args: unknown[]) => getWriteProposal(...args),
}));

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
