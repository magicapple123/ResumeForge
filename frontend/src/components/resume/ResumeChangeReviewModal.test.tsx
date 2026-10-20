// SPDX-License-Identifier: Apache-2.0
/**
 * 按条审阅弹窗（RF-13）：逐条接受/拒绝、verdict 提示与台账跳转链接、
 * 确定后只回调被接受的变更。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumePendingChange } from "../../types";
import ResumeChangeReviewModal from "./ResumeChangeReviewModal";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const CHANGES: ResumePendingChange[] = [
  {
    path: "summary",
    before: "后端开发工程师",
    after: "三年后端开发经验，擅长 API 设计",
    origin: "ai_rewrite",
    instruction: "更具体一点",
    subject: "某科技公司",
    verdict: "fact_check_needed",
    reasons: ["量化结果 30% 在个人资料中找不到依据，建议先核实"],
  },
  {
    path: "projects.0.description",
    before: "AI 定制化简历生成平台",
    after: "AI 定制化简历生成平台，支持多模板",
    origin: "ai_rewrite",
    verdict: "ok",
    reasons: [],
  },
];

function renderModal(onConfirm = vi.fn(), onCancel = vi.fn()) {
  render(
    <AntdApp>
      <MemoryRouter>
        <ResumeChangeReviewModal
          open
          pendingChanges={CHANGES}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </MemoryRouter>
    </AntdApp>,
  );
  return { onConfirm, onCancel };
}

describe("ResumeChangeReviewModal", () => {
  it("逐条渲染 diff 与来源 Tag，先删后增", () => {
    renderModal();
    // before 独有词出现在删除行、after 独有词出现在新增行。
    expect(screen.getByText(/擅长/)).toBeInTheDocument();
    expect(screen.getAllByText("AI 改写").length).toBe(2);
    expect(screen.getByText("改写要求：更具体一点")).toBeInTheDocument();
  });

  it("verdict=fact_check_needed 显示核实提示与台账跳转链接（带 subject 关键词）", () => {
    renderModal();
    expect(screen.getAllByText(/涉及事实，建议回台账核实/).length).toBeGreaterThan(0);
    expect(screen.getByText(/量化结果 30%/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "去事实台账核实" });
    expect(link).toHaveAttribute(
      "href",
      "/claims?keyword=%E6%9F%90%E7%A7%91%E6%8A%80%E5%85%AC%E5%8F%B8",
    );
  });

  it("默认未决；逐条接受后确定，只回调被接受的变更", async () => {
    const { onConfirm } = renderModal();
    expect(screen.getByTestId("review-accept-count")).toHaveTextContent("已接受 0 条，未决 2 条");

    const acceptButtons = screen.getAllByRole("button", { name: "接 受" });
    fireEvent.click(acceptButtons[0]);
    fireEvent.click(acceptButtons[1]);
    expect(screen.getByTestId("review-accept-count")).toHaveTextContent("已接受 2 条");

    fireEvent.click(screen.getByRole("button", { name: /应用所选（2）/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toHaveLength(2);
  });

  it("拒绝某一条后，确定只回调另一条", async () => {
    const { onConfirm } = renderModal();
    const acceptButtons = screen.getAllByRole("button", { name: "接 受" });
    const rejectButtons = screen.getAllByRole("button", { name: "拒 绝" });
    fireEvent.click(acceptButtons[1]);
    fireEvent.click(rejectButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: /应用所选（1）/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual([CHANGES[1]]);
  });

  it("「全部接受」一键接受所有条目", async () => {
    const { onConfirm } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "全部接受" }));
    expect(screen.getByTestId("review-accept-count")).toHaveTextContent("已接受 2 条");

    fireEvent.click(screen.getByRole("button", { name: /应用所选（2）/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });
});
